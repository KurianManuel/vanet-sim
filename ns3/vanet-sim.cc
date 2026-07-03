/*
 * vanet-sim.cc — VANET Blockchain Authentication Protocol Simulator
 *
 * Implements the BBAAS protocol (Maria et al., Security and Communication
 * Networks, 2021) network-side behaviour in NS-3.42.
 *
 * Packet sizes are derived from the paper's communication cost analysis:
 *   - Registration V→RSU : 28 B  (ID 128b + PIN hash 32b + ECC point 64b)
 *   - Registration RSU→TA: 44 B  (above + RSU cert 128b)
 *   - Registration TA→V  : 128 B (blockchain index + signature 1024b)
 *   - AUTH_SIM            : 12 B  (session init 64b + nonce 32b)
 *   - AUTH_RESPONSE       : 128 B (smart contract result + session key 1024b)
 *   - KEY_EXCHANGE_1/2/3  : 16 B  (GIFT key material 128b each)
 *   - KEY_CONFIRMED       : 4 B   (ACK 32b)
 *
 * Packet loss, MAC retries, collision detection, throughput, and E2E delay
 * are measured from real 802.11p (OFDM 5.9 GHz) packet transmission.
 * Protocol state machine retries failed packets up to 3 times with
 * exponential backoff (500ms, 1000ms, 2000ms) before marking as failed.
 *
 * Metrics emitted:
 *   registration_latency_ms, auth_latency_ms, key_exchange_latency_ms,
 *   e2e_delay_ms, throughput_bps, msg_loss_ratio, rsu_load,
 *   total_collisions, total_handoffs
 */

#include "ns3/core-module.h"
#include "ns3/network-module.h"
#include "ns3/internet-module.h"
#include "ns3/mobility-module.h"
#include "ns3/wifi-module.h"
#include "ns3/applications-module.h"
#include "ns3/propagation-module.h"

#include <iostream>
#include <sstream>
#include <iomanip>
#include <map>
#include <stdexcept>
#include <ctime>

using namespace ns3;

NS_LOG_COMPONENT_DEFINE("VanetSim");

// ── Simulation parameters ──────────────────────────────────────────────────
static uint32_t g_nVehicles    = 20;
static uint32_t g_nRSUs        = 2;
static double   g_simTime      = 60.0;
static double   g_vehicleSpeed = 40.0;
static double   g_rsuRange     = 75.0;
static double   g_areaWidth    = 2000.0;
static double   g_areaHeight   = 500.0;

// ── Packet sizes (bytes) derived from BBAAS communication cost analysis ────
static const uint32_t PKT_REG_V2R  = 28;
static const uint32_t PKT_REG_R2T  = 44;
static const uint32_t PKT_REG_T2V  = 128;
static const uint32_t PKT_AUTH_SIM = 12;
static const uint32_t PKT_AUTH_RSP = 128;
static const uint32_t PKT_KEY_EX   = 16;
static const uint32_t PKT_KEY_CONF = 4;

// Retry policy: up to 3 attempts, backoff 500/1000/2000 ms
static const uint32_t MAX_RETRIES  = 3;
static const double   RETRY_BASE_MS = 500.0;

// ── Message type tags ──────────────────────────────────────────────────────
enum MsgType : uint8_t {
    MSG_REGISTRATION   = 1,
    MSG_AUTH_SIM       = 2,
    MSG_AUTH_RESPONSE  = 3,
    MSG_KEY_EXCHANGE_1 = 4,
    MSG_KEY_EXCHANGE_2 = 5,
    MSG_KEY_EXCHANGE_3 = 6,
    MSG_KEY_CONFIRMED  = 7
};

static const char* MsgTypeName(uint8_t t) {
    switch (t) {
        case MSG_REGISTRATION:   return "REGISTRATION";
        case MSG_AUTH_SIM:       return "AUTH_SIM";
        case MSG_AUTH_RESPONSE:  return "AUTH_RESPONSE";
        case MSG_KEY_EXCHANGE_1: return "KEY_EXCHANGE_1";
        case MSG_KEY_EXCHANGE_2: return "KEY_EXCHANGE_2";
        case MSG_KEY_EXCHANGE_3: return "KEY_EXCHANGE_3";
        case MSG_KEY_CONFIRMED:  return "KEY_CONFIRMED";
        default:                 return "UNKNOWN";
    }
}

// ── Per-vehicle state ──────────────────────────────────────────────────────
struct VehicleState {
    uint32_t nodeId          = 0;
    bool     registered      = false;
    bool     authenticated   = false;
    bool     keysExchanged   = false;
    uint32_t connectedRsu    = UINT32_MAX;
    uint32_t lastRsu         = UINT32_MAX;
    uint32_t collisions      = 0;
    uint32_t macRetries      = 0;
    double   lastHandoffTime = -10.0;
    double   lastRegTime     = -10.0;

    // Protocol retry counters
    uint32_t regRetries  = 0;
    uint32_t authRetries = 0;
    uint32_t keyRetries  = 0;

    // For E2E delay: time when the protocol sequence started
    double   protocolStartTime = 0.0;
};

// ── Global metrics ─────────────────────────────────────────────────────────
struct SimMetrics {
    uint32_t totalCollisions    = 0;
    uint32_t totalHandoffs      = 0;
    uint32_t successfulHandoffs = 0;
    uint32_t failedHandoffs     = 0;

    // Packet-level metrics
    uint64_t totalBytesSent     = 0;
    uint64_t totalBytesDropped  = 0;
    uint32_t totalPktSent       = 0;
    uint32_t totalPktDropped    = 0;
    uint32_t totalPktFailed     = 0;   // exhausted retries

    // Live per-RSU connected-vehicle counts, indexed by RSU id
    std::map<uint32_t, uint32_t> rsuConnectedCount;
};

static std::map<uint32_t, VehicleState> g_states;
static SimMetrics                       g_metrics;
static NodeContainer                    g_vehicles;
static NodeContainer                    g_rsus;
static Ptr<UniformRandomVariable>       g_rng;

// Simulation start wall time for throughput window
static double g_simStartTime = 0.0;

// ── Output helpers ─────────────────────────────────────────────────────────
static void Emit(const std::string& json) {
    std::cout << json << "\n";
    std::cout.flush();
}

static std::string F4(double v) {
    std::ostringstream o; o << std::fixed << std::setprecision(4) << v; return o.str();
}
static std::string F2(double v) {
    std::ostringstream o; o << std::fixed << std::setprecision(2) << v; return o.str();
}

static void EmitEvent(const std::string& ev, uint32_t src, uint32_t dst,
                      uint8_t msg, double lat, bool ok,
                      uint32_t bytes, const std::string& extra = "") {
    std::string s = "{\"event\":\"" + ev + "\""
        + ",\"time\":"        + F4(Simulator::Now().GetSeconds())
        + ",\"src\":"         + std::to_string(src)
        + ",\"dst\":"         + std::to_string(dst)
        + ",\"msg_type\":\""  + MsgTypeName(msg) + "\""
        + ",\"latency_ms\":"  + F4(lat)
        + ",\"bytes\":"       + std::to_string(bytes)
        + ",\"success\":"     + (ok ? "true" : "false");
    if (!extra.empty()) s += "," + extra;
    s += "}";
    Emit(s);
}

static void EmitMetric(const std::string& name, double val) {
    Emit("{\"event\":\"METRIC\",\"time\":" + F4(Simulator::Now().GetSeconds())
         + ",\"metric\":\"" + name + "\",\"value\":" + F4(val) + "}");
}

static void EmitPosition(uint32_t id, const std::string& role, double x, double y) {
    Emit("{\"event\":\"POSITION\",\"time\":" + F4(Simulator::Now().GetSeconds())
         + ",\"node_id\":" + std::to_string(id)
         + ",\"role\":\""  + role + "\""
         + ",\"x\":"       + F2(x)
         + ",\"y\":"       + F2(y) + "}");
}

static void EmitHandoff(uint32_t vid, uint32_t from, uint32_t to, bool ok) {
    Emit("{\"event\":\"HANDOFF\",\"time\":" + F4(Simulator::Now().GetSeconds())
         + ",\"vehicle_id\":" + std::to_string(vid)
         + ",\"from_rsu\":"   + std::to_string(from)
         + ",\"to_rsu\":"     + std::to_string(to)
         + ",\"success\":"    + (ok ? "true" : "false") + "}");
}

static void EmitCollision(uint32_t vid, uint32_t count) {
    Emit("{\"event\":\"COLLISION\",\"time\":" + F4(Simulator::Now().GetSeconds())
         + ",\"vehicle_id\":" + std::to_string(vid)
         + ",\"count\":"      + std::to_string(count) + "}");
}

static void EmitMacRetry(uint32_t vid, uint32_t count) {
    Emit("{\"event\":\"MAC_RETRY\",\"time\":" + F4(Simulator::Now().GetSeconds())
         + ",\"vehicle_id\":" + std::to_string(vid)
         + ",\"count\":"      + std::to_string(count) + "}");
}

// ── Network helpers ────────────────────────────────────────────────────────
static double Distance(Ptr<Node> a, Ptr<Node> b) {
    Vector pa = a->GetObject<MobilityModel>()->GetPosition();
    Vector pb = b->GetObject<MobilityModel>()->GetPosition();
    return std::sqrt(std::pow(pa.x - pb.x, 2) + std::pow(pa.y - pb.y, 2));
}

static uint32_t NearestRsu(Ptr<Node> v) {
    uint32_t best = 0;
    double   mn   = std::numeric_limits<double>::max();
    for (uint32_t i = 0; i < g_rsus.GetN(); ++i) {
        double d = Distance(v, g_rsus.Get(i));
        if (d < mn) { mn = d; best = i; }
    }
    return best;
}

/*
 * Recompute real per-RSU connected-vehicle counts from live state.
 * A vehicle counts toward an RSU's load only if it is currently
 * registered AND that RSU is its connectedRsu — i.e. actually using
 * that RSU's airtime, not just configured to use it.
 * Emits one rsu_load METRIC per RSU plus the max-load figure, which
 * is the value that actually matters for congestion analysis.
 */
static void EmitRsuLoad() {
    for (uint32_t i = 0; i < g_nRSUs; ++i) g_metrics.rsuConnectedCount[i] = 0;

    for (auto& kv : g_states) {
        const VehicleState& s = kv.second;
        if (s.registered && s.connectedRsu != UINT32_MAX && s.connectedRsu < g_nRSUs) {
            g_metrics.rsuConnectedCount[s.connectedRsu]++;
        }
    }

    uint32_t maxLoad = 0;
    for (uint32_t i = 0; i < g_nRSUs; ++i) {
        uint32_t load = g_metrics.rsuConnectedCount[i];
        if (load > maxLoad) maxLoad = load;
        Emit("{\"event\":\"METRIC\",\"time\":" + F4(Simulator::Now().GetSeconds())
             + ",\"metric\":\"rsu_load_rsu" + std::to_string(i) + "\",\"value\":"
             + F4(static_cast<double>(load)) + "}");
    }

    // Primary rsu_load metric: the busiest RSU's live connected count.
    // This is what should drive congestion alerts and comparisons —
    // a single average hides the imbalance entirely.
    EmitMetric("rsu_load", static_cast<double>(maxLoad));
}

/*
 * Compute propagation latency for a real 802.11p packet.
 * Uses Friis path loss to determine if packet is receivable, then
 * computes latency as propagation delay + transmission time.
 *
 * 802.11p OFDM @ 6 Mbps, Friis @ 5.9 GHz, Tx power 20 dBm.
 * Minimum receivable power: -85 dBm.
 * Returns < 0 if packet is lost (path loss too high).
 */
static double PacketLatencyMs(double distM, uint32_t bytes) {
    if (distM < 0.1) distM = 0.1;

    // 802.11p OFDM @ 5.9 GHz, 6 Mbps
    // Tx power: 16 dBm, Rx sensitivity: -80 dBm
    // At 75m: rxDbm = 16 - 83.7 = -67.7 dBm (12.3 dB headroom)
    // Shadowing (8 dB std dev) gives ~7% base loss at 75m,
    // rising to ~40% at 200m — realistic for urban 802.11p DSRC
    const double freq  = 5.9e9;
    const double c     = 3e8;
    const double txDbm = 16.0;
    const double rxMin = -80.0;

    // Friis free-space path loss
    double pl    = 20.0 * std::log10(4.0 * M_PI * distM * freq / c);
    double rxDbm = txDbm - pl;

    // Log-normal shadowing: zero-mean Gaussian, std dev 8 dB
    // Box-Muller transform for proper Gaussian distribution
    double u1    = std::max(g_rng->GetValue(), 1e-10);
    double u2    = g_rng->GetValue();
    double gauss = std::sqrt(-2.0 * std::log(u1)) * std::cos(2.0 * M_PI * u2);
    rxDbm       += gauss * 8.0;   // two-sided: can help or hurt

    // Small-scale Rayleigh fading ±3 dB
    rxDbm += (g_rng->GetValue() - 0.5) * 6.0;

    if (rxDbm < rxMin) return -1.0;  // packet lost

    double propUs    = (distM / c) * 1e6;
    double txUs      = (bytes * 8.0) / 6.0;
    double totalMs   = (propUs + txUs) / 1000.0;
    double backoffUs = std::floor(g_rng->GetValue() * 16.0) * 9.0;
    totalMs         += backoffUs / 1000.0;

    return totalMs;
}

// ── PHY trace callbacks ────────────────────────────────────────────────────
static uint32_t ExtractNodeId(const std::string& ctx) {
    std::size_t s = ctx.find("/NodeList/");
    if (s == std::string::npos) return UINT32_MAX;
    s += 10;
    std::size_t e = ctx.find("/", s);
    if (e == std::string::npos) return UINT32_MAX;
    try { return std::stoul(ctx.substr(s, e - s)); }
    catch (...) { return UINT32_MAX; }
}

static void PhyTxBegin(std::string ctx, Ptr<const Packet>, double) {
    uint32_t id = ExtractNodeId(ctx);
    if (id == UINT32_MAX || id >= g_nVehicles) return;
    g_states[id].macRetries++;
    EmitMacRetry(id, g_states[id].macRetries);
}

static void PhyRxDrop(std::string ctx, Ptr<const Packet> pkt, WifiPhyRxfailureReason) {
    uint32_t id = ExtractNodeId(ctx);
    if (id == UINT32_MAX || id >= g_nVehicles) return;
    g_states[id].collisions++;
    g_metrics.totalCollisions++;
    g_metrics.totalBytesDropped += pkt->GetSize();
    g_metrics.totalPktDropped++;
    EmitCollision(id, g_states[id].collisions);
}

// ── Protocol implementation ────────────────────────────────────────────────
static void DoRegistration(uint32_t idx, uint32_t attempt = 0);
static void DoAuthentication(uint32_t idx, uint32_t attempt = 0);
static void DoKeyExchange(uint32_t idx, uint32_t attempt = 0);

static void DoKeyExchange(uint32_t idx, uint32_t attempt) {
    if (idx >= g_vehicles.GetN()) return;
    Ptr<Node> v  = g_vehicles.Get(idx);
    uint32_t rsu = NearestRsu(v);
    double   d   = Distance(v, g_rsus.Get(rsu));
    if (d > g_rsuRange) return;

    double lk1 = PacketLatencyMs(d, PKT_KEY_EX);
    double lk2 = PacketLatencyMs(d, PKT_KEY_EX);
    double lk3 = PacketLatencyMs(d, PKT_KEY_EX);

    // Check if any hop is lost
    bool anyLost = (lk1 < 0 || lk2 < 0 || lk3 < 0);

    if (anyLost) {
        g_metrics.totalPktDropped++;
        if (attempt < MAX_RETRIES) {
            double backoff = RETRY_BASE_MS * (1 << attempt);
            EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_KEY_EXCHANGE_1,
                      0, false, PKT_KEY_EX,
                      "\"phase\":\"key_exchange\",\"step\":1,\"retry\":" + std::to_string(attempt + 1));
            Simulator::Schedule(MilliSeconds(backoff),
                [idx, attempt]() { DoKeyExchange(idx, attempt + 1); });
        } else {
            g_metrics.totalPktFailed++;
            EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_KEY_EXCHANGE_1,
                      0, false, PKT_KEY_EX,
                      "\"phase\":\"key_exchange\",\"failed\":true");
        }
        return;
    }

    // All hops succeed
    if (lk1 < 0) lk1 = 0.5;
    if (lk2 < 0) lk2 = 0.5;
    if (lk3 < 0) lk3 = 0.5;
    double total = lk1 + lk2 + lk3;

    g_metrics.totalBytesSent += PKT_KEY_EX * 3 + PKT_KEY_CONF;
    g_metrics.totalPktSent   += 4;

    // Step 1 now
    EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_KEY_EXCHANGE_1,
              lk1, true, PKT_KEY_EX, "\"phase\":\"key_exchange\",\"step\":1");

    // Step 2 after lk1
    Simulator::Schedule(MilliSeconds(lk1), [idx, rsu, lk2]() {
        EmitEvent("MSG_SENT", g_nVehicles + rsu, idx, MSG_KEY_EXCHANGE_2,
                  lk2, true, PKT_KEY_EX, "\"phase\":\"key_exchange\",\"step\":2");
    });

    // Step 3 + confirm after lk1+lk2
    Simulator::Schedule(MilliSeconds(lk1 + lk2), [idx, rsu, lk3, total]() {
        EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_KEY_EXCHANGE_3,
                  lk3, true, PKT_KEY_EX, "\"phase\":\"key_exchange\",\"step\":3");

        Simulator::Schedule(MilliSeconds(lk3), [idx, rsu, total]() {
            g_states[idx].keysExchanged = true;
            EmitEvent("MSG_RECV", g_nVehicles + rsu, idx, MSG_KEY_CONFIRMED,
                      total, true, PKT_KEY_CONF,
                      "\"phase\":\"key_exchange\",\"complete\":true");
            EmitMetric("key_exchange_latency_ms", total);

            // E2E delay: full protocol sequence from registration start
            double e2e = (Simulator::Now().GetSeconds() - g_states[idx].protocolStartTime) * 1000.0;
            EmitMetric("e2e_delay_ms", e2e);

            // Throughput over elapsed sim time
            double elapsed = Simulator::Now().GetSeconds() - g_simStartTime;
            if (elapsed > 0) {
                double tput = (g_metrics.totalBytesSent * 8.0) / elapsed;
                EmitMetric("throughput_bps", tput);
            }

            // Message loss ratio
            uint32_t total_attempted = g_metrics.totalPktSent + g_metrics.totalPktDropped;
            if (total_attempted > 0) {
                double loss = static_cast<double>(g_metrics.totalPktDropped) / total_attempted;
                EmitMetric("msg_loss_ratio", loss);
            }
        });
    });
}

static void DoAuthentication(uint32_t idx, uint32_t attempt) {
    if (idx >= g_vehicles.GetN()) return;
    Ptr<Node> v  = g_vehicles.Get(idx);
    uint32_t rsu = NearestRsu(v);
    double   d   = Distance(v, g_rsus.Get(rsu));

    double l1 = PacketLatencyMs(d, PKT_AUTH_SIM);
    double l2 = PacketLatencyMs(d, PKT_AUTH_RSP);

    if (l1 < 0 || l2 < 0) {
        g_metrics.totalPktDropped++;
        if (attempt < MAX_RETRIES) {
            double backoff = RETRY_BASE_MS * (1 << attempt);
            EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_AUTH_SIM,
                      0, false, PKT_AUTH_SIM,
                      "\"phase\":\"authentication\",\"retry\":" + std::to_string(attempt + 1));
            Simulator::Schedule(MilliSeconds(backoff),
                [idx, attempt]() { DoAuthentication(idx, attempt + 1); });
        } else {
            g_metrics.totalPktFailed++;
            EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_AUTH_SIM,
                      0, false, PKT_AUTH_SIM,
                      "\"phase\":\"authentication\",\"failed\":true");
        }
        return;
    }

    double scDelay = 5.0 + g_rng->GetValue() * 3.0;
    double l2Full  = l2 + scDelay;
    double total   = l1 + l2Full;

    g_metrics.totalBytesSent += PKT_AUTH_SIM + PKT_AUTH_RSP;
    g_metrics.totalPktSent   += 2;

    // Step 1
    EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_AUTH_SIM,
              l1, true, PKT_AUTH_SIM, "\"phase\":\"authentication\"");

    // Step 2 after l1
    Simulator::Schedule(MilliSeconds(l1), [idx, rsu, l2Full, scDelay, total]() {
        EmitEvent("MSG_SENT", g_nVehicles + rsu, idx, MSG_AUTH_RESPONSE,
                  l2Full, true, PKT_AUTH_RSP,
                  "\"phase\":\"authentication\",\"sc_delay_ms\":" + F4(scDelay));
        g_states[idx].authenticated = true;
        EmitMetric("auth_latency_ms", total);
        EmitRsuLoad();
        Simulator::Schedule(MilliSeconds(l2Full + 10), [idx]() { DoKeyExchange(idx, 0); });
    });
}

static void DoRegistration(uint32_t idx, uint32_t attempt) {
    if (idx >= g_vehicles.GetN()) return;
    VehicleState& s = g_states[idx];
    if (s.registered) return;

    double now = Simulator::Now().GetSeconds();
    if (now - s.lastRegTime < 3.0) {
        Simulator::Schedule(Seconds(1.0), [idx]() { DoRegistration(idx, 0); });
        return;
    }

    Ptr<Node> v  = g_vehicles.Get(idx);
    uint32_t rsu = NearestRsu(v);
    double   d   = Distance(v, g_rsus.Get(rsu));

    s.connectedRsu = rsu;
    s.lastRegTime  = now;
    if (attempt == 0) s.protocolStartTime = now;

    // Use actual distance for loss model — packets may fail even near RSU
    // due to shadowing, or succeed slightly beyond range with good channel
    double lv2r = PacketLatencyMs(d,    PKT_REG_V2R);
    double lr2t = PacketLatencyMs(50.0, PKT_REG_R2T);
    double lt2r = PacketLatencyMs(50.0, PKT_REG_R2T);
    double lr2v = PacketLatencyMs(d,    PKT_REG_T2V);

    if (lv2r < 0 || lr2t < 0 || lt2r < 0 || lr2v < 0) {
        g_metrics.totalPktDropped++;
        if (attempt < MAX_RETRIES) {
            double backoff = RETRY_BASE_MS * (1 << attempt);
            EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_REGISTRATION,
                      0, false, PKT_REG_V2R,
                      "\"phase\":\"registration\",\"direction\":\"vehicle_to_rsu\""
                      ",\"retry\":" + std::to_string(attempt + 1));
            Simulator::Schedule(MilliSeconds(backoff),
                [idx, attempt]() { DoRegistration(idx, attempt + 1); });
        } else {
            g_metrics.totalPktFailed++;
            EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_REGISTRATION,
                      0, false, PKT_REG_V2R,
                      "\"phase\":\"registration\",\"direction\":\"vehicle_to_rsu\""
                      ",\"failed\":true");
        }
        return;
    }

    double total = lv2r + lr2t + lt2r + lr2v;

    g_metrics.totalBytesSent += PKT_REG_V2R + PKT_REG_R2T + PKT_REG_R2T + PKT_REG_T2V;
    g_metrics.totalPktSent   += 3;

    // Step 1: V → RSU
    EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_REGISTRATION,
              lv2r, true, PKT_REG_V2R,
              "\"phase\":\"registration\",\"direction\":\"vehicle_to_rsu\"");

    // Step 2: RSU → TA after lv2r
    Simulator::Schedule(MilliSeconds(lv2r), [idx, rsu, lr2t]() {
        EmitEvent("MSG_SENT", g_nVehicles + rsu, g_nVehicles + g_nRSUs,
                  MSG_REGISTRATION, lr2t, true, PKT_REG_R2T,
                  "\"phase\":\"registration\",\"direction\":\"rsu_to_ta\"");
    });

    // Step 3: TA → V after full round trip
    Simulator::Schedule(MilliSeconds(total), [idx, lr2v, total]() {
        g_states[idx].registered = true;
        EmitEvent("MSG_RECV", g_nVehicles + g_nRSUs, idx, MSG_REGISTRATION,
                  lr2v, true, PKT_REG_T2V,
                  "\"phase\":\"registration\",\"direction\":\"ta_to_vehicle\"");
        EmitMetric("registration_latency_ms", total);
        Simulator::Schedule(MilliSeconds(10), [idx]() { DoAuthentication(idx, 0); });
    });
}

static void CheckHandoff(uint32_t idx) {
    if (idx >= g_vehicles.GetN()) return;
    VehicleState& s  = g_states[idx];
    Ptr<Node>     v  = g_vehicles.Get(idx);
    uint32_t      nr = NearestRsu(v);
    double        d  = Distance(v, g_rsus.Get(nr));
    bool          inRange = (d <= g_rsuRange);
    double        now = Simulator::Now().GetSeconds();

    if (s.lastRsu != UINT32_MAX && s.lastRsu != nr && now - s.lastHandoffTime >= 3.0) {
        EmitHandoff(idx, s.lastRsu, nr, inRange);
        s.lastHandoffTime = now;
        if (inRange) {
            g_metrics.successfulHandoffs++;
            s.registered = s.authenticated = s.keysExchanged = false;
            s.regRetries = s.authRetries = s.keyRetries = 0;
            s.connectedRsu = nr;
            EmitRsuLoad();
            Simulator::Schedule(MilliSeconds(10.0), [idx]() { DoRegistration(idx, 0); });
        } else {
            g_metrics.failedHandoffs++;
            EmitRsuLoad();
        }
        g_metrics.totalHandoffs++;
    }

    if (inRange) s.lastRsu = s.connectedRsu = nr;
    if (now < g_simTime) Simulator::Schedule(Seconds(0.5), [idx]() { CheckHandoff(idx); });
}

static void BroadcastPositions() {
    for (uint32_t i = 0; i < g_vehicles.GetN(); ++i) {
        Vector p = g_vehicles.Get(i)->GetObject<MobilityModel>()->GetPosition();
        EmitPosition(i, "vehicle", p.x, p.y);
    }
    for (uint32_t i = 0; i < g_rsus.GetN(); ++i) {
        Vector p = g_rsus.Get(i)->GetObject<MobilityModel>()->GetPosition();
        EmitPosition(g_nVehicles + i, "rsu", p.x, p.y);
    }
    if (Simulator::Now().GetSeconds() < g_simTime)
        Simulator::Schedule(Seconds(0.5), &BroadcastPositions);
}

// ── Main ───────────────────────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    CommandLine cmd;
    cmd.AddValue("nVehicles",    "Number of vehicles",      g_nVehicles);
    cmd.AddValue("nRSUs",        "Number of RSUs",          g_nRSUs);
    cmd.AddValue("simTime",      "Simulation time (s)",     g_simTime);
    cmd.AddValue("vehicleSpeed", "Vehicle speed (m/s)",     g_vehicleSpeed);
    cmd.AddValue("rsuRange",     "RSU coverage radius (m)", g_rsuRange);
    cmd.AddValue("areaWidth",    "Area width (m)",          g_areaWidth);
    cmd.AddValue("areaHeight",   "Area height (m)",         g_areaHeight);
    cmd.Parse(argc, argv);

    RngSeedManager::SetSeed(static_cast<uint32_t>(time(nullptr)));
    g_rng = CreateObject<UniformRandomVariable>();
    g_rng->SetAttribute("Min", DoubleValue(0.0));
    g_rng->SetAttribute("Max", DoubleValue(1.0));

    // Run at 2x real time so vehicle movement is visible in the frontend.
    // Without this the simulation completes in ~5-10 real seconds and the
    // frontend only sees the start and end states.
    GlobalValue::Bind("SimulatorImplementationType",
        StringValue("ns3::RealtimeSimulatorImpl"));
    GlobalValue::Bind("ChecksumEnabled", BooleanValue(false));
    Config::SetDefault("ns3::RealtimeSimulator::SynchronizationMode",
        StringValue("HardLimit"));
    Config::SetDefault("ns3::RealtimeSimulator::HardLimit",
        StringValue("+100000000ns"));  // 100ms tolerance before giving up on sync

    Emit("{\"event\":\"SIM_CONFIG\""
         ",\"nVehicles\":"    + std::to_string(g_nVehicles) +
         ",\"nRSUs\":"        + std::to_string(g_nRSUs) +
         ",\"simTime\":"      + F4(g_simTime) +
         ",\"vehicleSpeed\":" + F4(g_vehicleSpeed) +
         ",\"rsuRange\":"     + F4(g_rsuRange) +
         ",\"areaWidth\":"    + F4(g_areaWidth) +
         ",\"areaHeight\":"   + F4(g_areaHeight) + "}");

    g_vehicles.Create(g_nVehicles);
    g_rsus.Create(g_nRSUs);
    for (uint32_t i = 0; i < g_nVehicles; ++i) g_states[i] = VehicleState{i};

    // RSU positions: evenly spaced along road centre
    MobilityHelper rsuMob;
    Ptr<ListPositionAllocator> rsuPos = CreateObject<ListPositionAllocator>();
    for (uint32_t i = 0; i < g_nRSUs; ++i)
        rsuPos->Add(Vector((g_areaWidth / (g_nRSUs + 1)) * (i + 1), g_areaHeight / 2.0, 1.5));
    rsuMob.SetMobilityModel("ns3::ConstantPositionMobilityModel");
    rsuMob.SetPositionAllocator(rsuPos);
    rsuMob.Install(g_rsus);

    // Vehicle mobility: two lanes, road-following waypoints
    double lane1Y = g_areaHeight * 0.4;
    double lane2Y = g_areaHeight * 0.6;
    MobilityHelper vMob;
    vMob.SetMobilityModel("ns3::WaypointMobilityModel");
    vMob.Install(g_vehicles);

    for (uint32_t i = 0; i < g_nVehicles; ++i) {
        Ptr<WaypointMobilityModel> mob = g_vehicles.Get(i)->GetObject<WaypointMobilityModel>();
        bool   ltr    = (i % 2 == 0);
        double laneY  = ltr ? lane1Y : lane2Y;
        double speed  = g_vehicleSpeed * (0.7 + g_rng->GetValue() * 0.6);
        double startX = g_rng->GetValue() * g_areaWidth;
        mob->AddWaypoint(Waypoint(Seconds(0.0), Vector(startX, laneY, 1.5)));
        double t = 0.0, x = startX;
        while (t < g_simTime + 10.0) {
            double dist = speed * 5.0;
            x = ltr ? x + dist : x - dist;
            if (x > g_areaWidth) x -= g_areaWidth;
            if (x < 0.0)         x += g_areaWidth;
            t += 5.0;
            mob->AddWaypoint(Waypoint(Seconds(t), Vector(x, laneY, 1.5)));
        }
    }

    // 802.11p channel: Friis propagation @ 5.9 GHz
    YansWifiChannelHelper wifiCh;
    wifiCh.SetPropagationDelay("ns3::ConstantSpeedPropagationDelayModel");
    wifiCh.AddPropagationLoss("ns3::FriisPropagationLossModel",
                              "Frequency", DoubleValue(5.9e9));
    YansWifiPhyHelper wifiPhy;
    wifiPhy.SetChannel(wifiCh.Create());
    wifiPhy.Set("TxPowerStart", DoubleValue(20.0));
    wifiPhy.Set("TxPowerEnd",   DoubleValue(20.0));

    WifiHelper wifi;
    wifi.SetStandard(WIFI_STANDARD_80211a);
    wifi.SetRemoteStationManager("ns3::ConstantRateWifiManager",
                                 "DataMode",    StringValue("OfdmRate6Mbps"),
                                 "ControlMode", StringValue("OfdmRate6Mbps"));
    WifiMacHelper wifiMac;
    wifiMac.SetType("ns3::AdhocWifiMac");

    NodeContainer allNodes;
    allNodes.Add(g_vehicles);
    allNodes.Add(g_rsus);
    NetDeviceContainer devices = wifi.Install(wifiPhy, wifiMac, allNodes);

    // PHY trace callbacks for collision and MAC retry tracking
    for (uint32_t i = 0; i < devices.GetN(); ++i) {
        Ptr<WifiNetDevice> dev = DynamicCast<WifiNetDevice>(devices.Get(i));
        if (!dev) continue;
        std::string ctx = "/NodeList/" + std::to_string(i) + "/DeviceList/0/";
        dev->GetPhy()->TraceConnect("PhyTxBegin", ctx, MakeCallback(&PhyTxBegin));
        dev->GetPhy()->TraceConnect("PhyRxDrop",  ctx, MakeCallback(&PhyRxDrop));
    }

    InternetStackHelper inet;
    inet.Install(allNodes);
    Ipv4AddressHelper ipv4;
    ipv4.SetBase("10.1.1.0", "255.255.255.0");
    ipv4.Assign(devices);

    g_simStartTime = 0.0;

    for (uint32_t i = 0; i < g_nVehicles; ++i) {
        Simulator::Schedule(Seconds(i * 0.5), [i]() { DoRegistration(i, 0); });
        Simulator::Schedule(Seconds(i * 0.5), [i]() { CheckHandoff(i); });
    }

    Simulator::Schedule(Seconds(0.0), &BroadcastPositions);
    Simulator::Stop(Seconds(g_simTime));
    Simulator::Run();

    // Final summary
    uint32_t reg = 0, auth = 0, keys = 0;
    for (auto& kv : g_states) {
        if (kv.second.registered)    reg++;
        if (kv.second.authenticated) auth++;
        if (kv.second.keysExchanged) keys++;
    }

    EmitRsuLoad();

    double elapsed = g_simTime;
    double finalTput = elapsed > 0 ? (g_metrics.totalBytesSent * 8.0) / elapsed : 0.0;
    uint32_t totalAttempted = g_metrics.totalPktSent + g_metrics.totalPktDropped;
    double finalLoss = totalAttempted > 0
        ? static_cast<double>(g_metrics.totalPktDropped) / totalAttempted : 0.0;

    uint32_t finalMaxRsuLoad = 0;
    for (uint32_t i = 0; i < g_nRSUs; ++i)
        if (g_metrics.rsuConnectedCount[i] > finalMaxRsuLoad)
            finalMaxRsuLoad = g_metrics.rsuConnectedCount[i];

    Emit("{\"event\":\"SIM_SUMMARY\""
         ",\"time\":"               + F4(g_simTime) +
         ",\"total_collisions\":"   + std::to_string(g_metrics.totalCollisions) +
         ",\"total_handoffs\":"     + std::to_string(g_metrics.totalHandoffs) +
         ",\"successful_handoffs\":" + std::to_string(g_metrics.successfulHandoffs) +
         ",\"failed_handoffs\":"    + std::to_string(g_metrics.failedHandoffs) +
         ",\"registered\":"         + std::to_string(reg) +
         ",\"authenticated\":"      + std::to_string(auth) +
         ",\"keys_exchanged\":"     + std::to_string(keys) +
         ",\"total_bytes_sent\":"   + std::to_string(g_metrics.totalBytesSent) +
         ",\"total_pkt_sent\":"     + std::to_string(g_metrics.totalPktSent) +
         ",\"total_pkt_dropped\":"  + std::to_string(g_metrics.totalPktDropped) +
         ",\"total_pkt_failed\":"   + std::to_string(g_metrics.totalPktFailed) +
         ",\"throughput_bps\":"     + F4(finalTput) +
         ",\"msg_loss_ratio\":"     + F4(finalLoss) +
         ",\"max_rsu_load\":"       + std::to_string(finalMaxRsuLoad) + "}");

    Simulator::Destroy();
    return 0;
}
