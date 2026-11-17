"use client";

// Captures the seller's signature as a PNG (pointer events: mouse, touch and stylus).
import { useEffect, useRef, useState } from "react";

export default function SignaturePad({ onChange }: { onChange: (png: Blob | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.strokeStyle = "#0b1f4b";
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = e.currentTarget.getContext("2d");
    if (!g) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    g.beginPath();
    g.moveTo(p.x, p.y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const g = e.currentTarget.getContext("2d");
    if (!g) return;
    const p = point(e);
    g.lineTo(p.x, p.y);
    g.stroke();
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    e.currentTarget.toBlob((b) => onChange(b), "image/png");
  }

  function clear() {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.fillRect(0, 0, c.width, c.height);
    setSigned(false);
    onChange(null);
  }

  return (
    <div className="stack">
      <canvas
        ref={canvas}
        width={600}
        height={200}
        className="signature-pad"
        aria-label="Signature area: sign with your finger, stylus or mouse"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="row">
        <span className="meta">{signed ? "Signed." : "Sign above."}</span>
        <button type="button" className="link-button" onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
}
