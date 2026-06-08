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

using namespace ns3;

NS_LOG_COMPONENT_DEFINE("VanetSim");

static uint32_t g_nVehicles    = 10;
static uint32_t g_nRSUs        = 3;
static double   g_simTime      = 60.0;
static double   g_vehicleSpeed = 20.0;
static double   g_rsuRange     = 200.0;
static double   g_areaWidth    = 1000.0;
static double   g_areaHeight   = 500.0;

enum MsgType {
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

struct VehicleState {
    uint32_t nodeId;
    bool     registered    = false;
    bool     authenticated = false;
    bool     keysExchanged = false;
    uint32_t connectedRsu  = UINT32_MAX;
    uint32_t lastRsu       = UINT32_MAX;
    uint32_t collisions    = 0;
    uint32_t macRetries    = 0;
};

struct SimMetrics {
    uint32_t totalCollisions      = 0;
    uint32_t totalHandoffs        = 0;
    uint32_t successfulHandoffs   = 0;
    uint32_t failedHandoffs       = 0;
};

static std::map<uint32_t, VehicleState> g_states;
static SimMetrics                       g_metrics;
static NodeContainer                    g_vehicles;
static NodeContainer                    g_rsus;
static Ptr<UniformRandomVariable>       g_rng;

static void Emit(const std::string& json) {
    std::cout << json << "\n";
    std::cout.flush();
}

static std::string F4(double v) {
    std::ostringstream o;
    o << std::fixed << std::setprecision(4) << v;
    return o.str();
}

static std::string F2(double v) {
    std::ostringstream o;
    o << std::fixed << std::setprecision(2) << v;
    return o.str();
}

static void EmitEvent(const std::string& ev, uint32_t src, uint32_t dst,
                      uint8_t msg, double lat, bool ok, const std::string& extra = "") {
    std::string s = "{\"event\":\"" + ev + "\",\"time\":" + F4(Simulator::Now().GetSeconds()) +
                    ",\"src\":" + std::to_string(src) +
                    ",\"dst\":" + std::to_string(dst) +
                    ",\"msg_type\":\"" + MsgTypeName(msg) + "\"" +
                    ",\"latency_ms\":" + F4(lat) +
                    ",\"success\":" + (ok ? "true" : "false");
    if (!extra.empty()) s += "," + extra;
    s += "}";
    Emit(s);
}

static void EmitMetric(const std::string& name, double val) {
    Emit("{\"event\":\"METRIC\",\"time\":" + F4(Simulator::Now().GetSeconds()) +
         ",\"metric\":\"" + name + "\",\"value\":" + F4(val) + "}");
}

static void EmitPosition(uint32_t id, const std::string& role, double x, double y) {
    Emit("{\"event\":\"POSITION\",\"time\":" + F4(Simulator::Now().GetSeconds()) +
         ",\"node_id\":" + std::to_string(id) +
         ",\"role\":\"" + role + "\"" +
         ",\"x\":" + F2(x) + ",\"y\":" + F2(y) + "}");
}

static void EmitHandoff(uint32_t vid, uint32_t from, uint32_t to, bool ok) {
    Emit("{\"event\":\"HANDOFF\",\"time\":" + F4(Simulator::Now().GetSeconds()) +
         ",\"vehicle_id\":" + std::to_string(vid) +
         ",\"from_rsu\":" + std::to_string(from) +
         ",\"to_rsu\":" + std::to_string(to) +
         ",\"success\":" + (ok ? "true" : "false") + "}");
}

static void EmitCollision(uint32_t vid, uint32_t count) {
    Emit("{\"event\":\"COLLISION\",\"time\":" + F4(Simulator::Now().GetSeconds()) +
         ",\"vehicle_id\":" + std::to_string(vid) +
         ",\"count\":" + std::to_string(count) + "}");
}

static void EmitMacRetry(uint32_t vid, uint32_t count) {
    Emit("{\"event\":\"MAC_RETRY\",\"time\":" + F4(Simulator::Now().GetSeconds()) +
         ",\"vehicle_id\":" + std::to_string(vid) +
         ",\"count\":" + std::to_string(count) + "}");
}

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

static void PhyRxDrop(std::string ctx, Ptr<const Packet>, WifiPhyRxfailureReason) {
    uint32_t id = ExtractNodeId(ctx);
    if (id == UINT32_MAX || id >= g_nVehicles) return;
    g_states[id].collisions++;
    g_metrics.totalCollisions++;
    EmitCollision(id, g_states[id].collisions);
}

static double Distance(Ptr<Node> a, Ptr<Node> b) {
    Vector pa = a->GetObject<MobilityModel>()->GetPosition();
    Vector pb = b->GetObject<MobilityModel>()->GetPosition();
    return std::sqrt(std::pow(pa.x - pb.x, 2) + std::pow(pa.y - pb.y, 2));
}

static uint32_t NearestRsu(Ptr<Node> v) {
    uint32_t best = 0;
    double   min  = std::numeric_limits<double>::max();
    for (uint32_t i = 0; i < g_rsus.GetN(); ++i) {
        double d = Distance(v, g_rsus.Get(i));
        if (d < min) { min = d; best = i; }
    }
    return best;
}

static double SimLatency(double dist) {
    return 2.0 + dist * 0.01 + g_rng->GetValue();
}

static void DoRegistration(uint32_t idx);
static void DoAuthentication(uint32_t idx);
static void DoKeyExchange(uint32_t idx);

static void DoKeyExchange(uint32_t idx) {
    Ptr<Node> v   = g_vehicles.Get(idx);
    VehicleState& s = g_states[idx];
    uint32_t rsu  = NearestRsu(v);
    double   d    = Distance(v, g_rsus.Get(rsu));
    if (d > g_rsuRange) return;

    double lk1 = SimLatency(d), lk2 = SimLatency(d), lk3 = SimLatency(d);

    EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_KEY_EXCHANGE_1, lk1, true,
              "\"phase\":\"key_exchange\",\"step\":1");
    EmitEvent("MSG_SENT", g_nVehicles + rsu, idx, MSG_KEY_EXCHANGE_2, lk2, true,
              "\"phase\":\"key_exchange\",\"step\":2");
    EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_KEY_EXCHANGE_3, lk3, true,
              "\"phase\":\"key_exchange\",\"step\":3");

    double total = lk1 + lk2 + lk3;
    s.keysExchanged = true;

    EmitEvent("MSG_RECV", g_nVehicles + rsu, idx, MSG_KEY_CONFIRMED, total, true,
              "\"phase\":\"key_exchange\",\"complete\":true");
    EmitMetric("key_exchange_latency_ms", total);
}

static void DoAuthentication(uint32_t idx) {
    Ptr<Node> v   = g_vehicles.Get(idx);
    VehicleState& s = g_states[idx];
    uint32_t rsu  = NearestRsu(v);
    double   d    = Distance(v, g_rsus.Get(rsu));
    if (d > g_rsuRange) return;

    double l1      = SimLatency(d);
    double scDelay = 5.0 + SimLatency(0) * 3.0;
    double l2      = SimLatency(d) + scDelay;
    double total   = l1 + l2;

    EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_AUTH_SIM, l1, true,
              "\"phase\":\"authentication\"");
    EmitEvent("MSG_SENT", g_nVehicles + rsu, idx, MSG_AUTH_RESPONSE, l2, true,
              "\"phase\":\"authentication\",\"sc_delay_ms\":" + F4(scDelay));

    s.authenticated = true;
    EmitMetric("auth_latency_ms", total);
    EmitMetric("rsu_load", static_cast<double>(g_nVehicles) / g_nRSUs);

    Simulator::Schedule(MilliSeconds(total + 10), &DoKeyExchange, idx);
}

static void DoRegistration(uint32_t idx) {
    if (idx >= g_vehicles.GetN()) return;
    VehicleState& s = g_states[idx];
    if (s.registered) return;

    Ptr<Node> v  = g_vehicles.Get(idx);
    uint32_t rsu = NearestRsu(v);
    double   d   = Distance(v, g_rsus.Get(rsu));

    if (d > g_rsuRange) {
        Simulator::Schedule(Seconds(1.0), &DoRegistration, idx);
        return;
    }

    s.connectedRsu = rsu;
    double lv2r    = SimLatency(d);
    double lr2t    = SimLatency(50.0);
    double total   = lv2r + lr2t + SimLatency(50.0) + SimLatency(d);

    EmitEvent("MSG_SENT", idx, g_nVehicles + rsu, MSG_REGISTRATION, lv2r, true,
              "\"phase\":\"registration\",\"direction\":\"vehicle_to_rsu\"");
    EmitEvent("MSG_SENT", g_nVehicles + rsu, g_nVehicles + g_nRSUs, MSG_REGISTRATION, lr2t, true,
              "\"phase\":\"registration\",\"direction\":\"rsu_to_ta\"");

    s.registered = true;

    EmitEvent("MSG_RECV", g_nVehicles + g_nRSUs, idx, MSG_REGISTRATION, total, true,
              "\"phase\":\"registration\",\"direction\":\"ta_to_vehicle\"");
    EmitMetric("registration_latency_ms", total);

    Simulator::Schedule(MilliSeconds(total + 10), &DoAuthentication, idx);
}

static void CheckHandoff(uint32_t idx) {
    if (idx >= g_vehicles.GetN()) return;
    VehicleState& s  = g_states[idx];
    Ptr<Node>     v  = g_vehicles.Get(idx);
    uint32_t      nr = NearestRsu(v);
    double        d  = Distance(v, g_rsus.Get(nr));
    bool          inRange = (d <= g_rsuRange);

    if (s.lastRsu != UINT32_MAX && s.lastRsu != nr) {
        EmitHandoff(idx, s.lastRsu, nr, inRange);
        if (inRange) {
            g_metrics.successfulHandoffs++;
            s.registered = s.authenticated = s.keysExchanged = false;
            s.connectedRsu = nr;
            Simulator::Schedule(MilliSeconds(10.0), &DoRegistration, idx);
        } else {
            g_metrics.failedHandoffs++;
        }
        g_metrics.totalHandoffs++;
    }

    if (inRange) s.lastRsu = s.connectedRsu = nr;

    if (Simulator::Now().GetSeconds() < g_simTime)
        Simulator::Schedule(Seconds(0.5), &CheckHandoff, idx);
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
    if (Simulator::Now().GetSeconds() < g_simTime) Simulator::Schedule(Seconds(1.0), &BroadcastPositions);
}

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

    Emit("{\"event\":\"SIM_CONFIG\",\"nVehicles\":" + std::to_string(g_nVehicles) +
         ",\"nRSUs\":" + std::to_string(g_nRSUs) +
         ",\"simTime\":" + F4(g_simTime) +
         ",\"vehicleSpeed\":" + F4(g_vehicleSpeed) +
         ",\"rsuRange\":" + F4(g_rsuRange) +
         ",\"areaWidth\":" + F4(g_areaWidth) +
         ",\"areaHeight\":" + F4(g_areaHeight) + "}");

    g_vehicles.Create(g_nVehicles);
    g_rsus.Create(g_nRSUs);

    for (uint32_t i = 0; i < g_nVehicles; ++i)
        g_states[i] = VehicleState{i};

    MobilityHelper rsuMob;
    Ptr<ListPositionAllocator> rsuPos = CreateObject<ListPositionAllocator>();
    for (uint32_t i = 0; i < g_nRSUs; ++i)
        rsuPos->Add(Vector((g_areaWidth / (g_nRSUs + 1)) * (i + 1), g_areaHeight / 2.0, 1.5));
    rsuMob.SetMobilityModel("ns3::ConstantPositionMobilityModel");
    rsuMob.SetPositionAllocator(rsuPos);
    rsuMob.Install(g_rsus);

    // Road-following mobility: two lanes along x-axis
    // Lane 1 (even vehicles): y = areaHeight * 0.4, moving left to right
    // Lane 2 (odd vehicles):  y = areaHeight * 0.6, moving right to left
    double lane1Y = g_areaHeight * 0.4;
    double lane2Y = g_areaHeight * 0.6;

    MobilityHelper vMob;
    vMob.SetMobilityModel("ns3::WaypointMobilityModel");
    vMob.Install(g_vehicles);

    for (uint32_t i = 0; i < g_nVehicles; ++i) {
        Ptr<WaypointMobilityModel> mob = g_vehicles.Get(i)->GetObject<WaypointMobilityModel>();
        bool ltr = (i % 2 == 0);
        double laneY = ltr ? lane1Y : lane2Y;
        double speed = g_vehicleSpeed * (0.7 + g_rng->GetValue() * 0.6);
        double startX = g_rng->GetValue() * g_areaWidth;

        // Stagger start positions along the road
        mob->AddWaypoint(Waypoint(Seconds(0.0), Vector(startX, laneY, 1.5)));

        // Add waypoints spanning the full simulation time
        double t = 0.0;
        double x = startX;
        while (t < g_simTime + 10.0) {
            double dist = speed * 5.0; // move in 5s segments
            x = ltr ? x + dist : x - dist;
            // Wrap around
            if (x > g_areaWidth) x = x - g_areaWidth;
            if (x < 0.0)         x = x + g_areaWidth;
            t += 5.0;
            mob->AddWaypoint(Waypoint(Seconds(t), Vector(x, laneY, 1.5)));
        }
    }

    YansWifiChannelHelper wifiCh;
    wifiCh.SetPropagationDelay("ns3::ConstantSpeedPropagationDelayModel");
    wifiCh.AddPropagationLoss("ns3::FriisPropagationLossModel", "Frequency", DoubleValue(5.9e9));

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

    for (uint32_t i = 0; i < g_nVehicles; ++i) {
        Simulator::Schedule(Seconds(i * 0.5), &DoRegistration, i);
        Simulator::Schedule(Seconds(i * 0.5), &CheckHandoff, i);
    }

    Simulator::Schedule(Seconds(0.0), &BroadcastPositions);
    Simulator::Stop(Seconds(g_simTime));
    Simulator::Run();

    uint32_t reg = 0, auth = 0, keys = 0;
    for (auto& kv : g_states) {
        if (kv.second.registered)    reg++;
        if (kv.second.authenticated) auth++;
        if (kv.second.keysExchanged) keys++;
    }

    Emit("{\"event\":\"SIM_SUMMARY\",\"time\":" + F4(g_simTime) +
         ",\"total_collisions\":"     + std::to_string(g_metrics.totalCollisions) +
         ",\"total_handoffs\":"       + std::to_string(g_metrics.totalHandoffs) +
         ",\"successful_handoffs\":"  + std::to_string(g_metrics.successfulHandoffs) +
         ",\"failed_handoffs\":"      + std::to_string(g_metrics.failedHandoffs) +
         ",\"registered\":"           + std::to_string(reg) +
         ",\"authenticated\":"        + std::to_string(auth) +
         ",\"keys_exchanged\":"       + std::to_string(keys) + "}");

    Simulator::Destroy();
    return 0;
}