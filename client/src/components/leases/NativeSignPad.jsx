import React, { useRef, useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';

function pointerPosition(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const point = event.touches?.[0] || event;
  return {
    x: (point.clientX - rect.left) * (canvas.width / rect.width),
    y: (point.clientY - rect.top) * (canvas.height / rect.height),
  };
}

export default function NativeSignPad({ leaseId, signerLabel = 'Tenant', onSigned }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [signedName, setSignedName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function startDrawing(event) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    drawingRef.current = true;
    hasInkRef.current = true;
    const ctx = canvas.getContext('2d');
    const { x, y } = pointerPosition(canvas, event);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(event) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const ctx = canvas.getContext('2d');
    const { x, y } = pointerPosition(canvas, event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDrawing() {
    drawingRef.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
  }

  async function submitSignature(event) {
    event.preventDefault();
    const trimmedName = signedName.trim();
    if (!trimmedName) {
      setError('Type your legal name to sign.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const signatureImage = hasInkRef.current
        ? canvasRef.current?.toDataURL('image/png')
        : null;
      const { data } = await api.post(`/api/leases/${leaseId}/native/sign`, {
        signedName: trimmedName,
        signatureImage,
      });
      onSigned?.(data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not submit your signature. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submitSignature} className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700">
          <CheckCircle2 size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-amber-900">Native e-signature required</h2>
          <p className="mt-1 text-xs text-amber-800">
            Review the lease PDF, type your legal name, and optionally draw your signature below.
          </p>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-amber-900">
            {signerLabel} legal name
            <input
              type="text"
              value={signedName}
              onChange={(event) => setSignedName(event.target.value)}
              placeholder="Type your full legal name"
              className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              autoComplete="name"
            />
          </label>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Draw signature (optional)</p>
              <button
                type="button"
                onClick={clearCanvas}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                <RotateCcw size={13} /> Clear
              </button>
            </div>
            <canvas
              ref={canvasRef}
              width={720}
              height={180}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              className="h-36 w-full touch-none rounded-lg border border-dashed border-amber-300 bg-white"
              aria-label="Optional signature drawing pad"
            />
          </div>

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting signature...' : 'Submit signature'}
          </button>
        </div>
      </div>
    </form>
  );
}
