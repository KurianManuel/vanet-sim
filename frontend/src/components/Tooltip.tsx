import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface Props { text: string }

const TIP_WIDTH = 230
const TIP_OFFSET = 10

export function InfoTip({ text }: Props) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, arrowLeft: '50%' })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!visible || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const vw = window.innerWidth

    // Center tooltip on button, then clamp to viewport
    let left = r.left + r.width / 2 - TIP_WIDTH / 2
    const minLeft = 8
    const maxLeft = vw - TIP_WIDTH - 8
    const clampedLeft = Math.max(minLeft, Math.min(left, maxLeft))

    // Arrow position relative to tooltip
    const arrowLeft = Math.min(
      Math.max((r.left + r.width / 2) - clampedLeft, 16),
      TIP_WIDTH - 16
    )

    setPos({
      top: r.top - TIP_OFFSET,
      left: clampedLeft,
      arrowLeft: `${arrowLeft}px`,
    })
  }, [visible])

  return (
    <>
      <button
        ref={btnRef}
        className="info-btn"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
      >i</button>
      {visible && createPortal(
        <div
          className="info-tooltip-portal"
          style={{ top: pos.top, left: pos.left, '--arrow-left': pos.arrowLeft } as React.CSSProperties}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  )
}
