import { Html5Qrcode } from 'html5-qrcode';
import {
  Camera,
  Check,
  Keyboard,
  X
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { cleanEanCode } from '../services/codeParser';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedCode: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
}) => {
  const [manualCode, setManualCode] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showManualInput, setShowManualInput] = useState(false);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const isScanningRef = useRef(false);

  // Play a crisp pleasant confirmation beep
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime); // 1200 Hz
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch {
      // AudioContext might be blocked until user gesture, safe to ignore
    }
  };

  const handleScanSuccess = (decodedText: string) => {
    if (!isScanningRef.current) return;
    isScanningRef.current = false;
    playBeep();

    const cleaned = cleanEanCode(decodedText);
    stopScanner().then(() => {
      onScan(cleaned);
      onClose();
    });
  };

  const stopScanner = async () => {
    try {
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        await html5QrCodeRef.current.stop();
        await html5QrCodeRef.current.clear();
      }
    } catch (e) {
      console.warn('Error stopping html5-qrcode scanner:', e);
    } finally {
      html5QrCodeRef.current = null;
      isScanningRef.current = false;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      return;
    }

    setIsInitializing(true);
    setScannerError(null);
    setShowManualInput(false);
    setManualCode('');

    const scannerElementId = 'reader-barcode-viewport';

    const timer = setTimeout(async () => {
      try {
        const qrCode = new Html5Qrcode(scannerElementId);
        html5QrCodeRef.current = qrCode;

        const config = {
          fps: 15,
          qrbox: { width: 280, height: 180 },
          aspectRatio: 1.0,
        };

        await qrCode.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            handleScanSuccess(decodedText);
          },
          () => {
            // Frame error during scanning (normal while searching)
          }
        );

        isScanningRef.current = true;
        setIsInitializing(false);
      } catch (err: any) {
        console.warn('Camera scan failed or permission denied:', err);
        setScannerError(
          'Câmera indisponível ou permissão não concedida. Você pode digitar o código da mercadoria no campo abaixo.'
        );
        setIsInitializing(false);
        setShowManualInput(true);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
  }, [isOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    playBeep();
    const clean = cleanEanCode(manualCode);
    stopScanner().then(() => {
      onScan(clean);
      onClose();
    });
  };

  if (!isOpen) return null;

  return (
    <div
      id="barcode-scanner-modal"
      className="fixed inset-0 z-50 bg-gray-950/95 backdrop-blur-xs flex flex-col justify-between p-4"
    >
      {/* Top Bar with Bold Typography */}
      <div className="flex items-center justify-between z-10 text-white pt-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-700 flex items-center justify-center border border-blue-500">
            <Camera className="w-5 h-5 text-white stroke-[2.5]" />
          </div>
          <div>
            <h3 className="font-black text-sm uppercase tracking-tight leading-tight">Leitor de Código de Barras</h3>
            <p className="text-xs text-blue-200 font-medium">Aponte para o EAN ou código da mercadoria</p>
          </div>
        </div>
        <button
          id="btn-close-scanner"
          onClick={() => {
            stopScanner();
            onClose();
          }}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white transition-colors"
          aria-label="Fechar leitor"
        >
          <X className="w-6 h-6 stroke-[2.5]" />
        </button>
      </div>

      {/* Center Viewport */}
      <div className="relative flex-1 flex flex-col items-center justify-center my-4 overflow-hidden rounded-2xl bg-black border border-gray-800">
        <div id="reader-barcode-viewport" className="w-full h-full max-w-sm max-h-[380px] overflow-hidden" />

        {isInitializing && !scannerError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/80 text-white gap-3 z-20">
            <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Inicializando câmera...</span>
          </div>
        )}

        {/* Framing Overlay and Red Laser Target Line */}
        {!scannerError && !isInitializing && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-10">
            <div className="w-64 h-36 border-2 border-blue-400 rounded-xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-blue-500 rounded-tl -mt-1 -ml-1" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-blue-500 rounded-tr -mt-1 -mr-1" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-blue-500 rounded-bl -mb-1 -ml-1" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-blue-500 rounded-br -mb-1 -mr-1" />

              {/* Scanning Red Laser Line */}
              <div className="absolute left-1 right-1 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)] animate-bounce" style={{ top: '48%' }} />
            </div>
          </div>
        )}

        {scannerError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gray-900 text-gray-200 z-20">
            <Camera className="w-12 h-12 text-gray-500 mb-2 stroke-[2]" />
            <p className="text-xs text-gray-300 mb-4 max-w-xs font-medium">{scannerError}</p>
          </div>
        )}
      </div>

      {/* Bottom Controls / Manual Input / Quick Demo EANs */}
      <div className="z-10 bg-gray-900/95 rounded-xl p-3.5 border border-gray-800 space-y-3">
        {/* Toggle Manual Input Button */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowManualInput(!showManualInput)}
            className="flex-1 py-2.5 px-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors border border-gray-700"
          >
            <Keyboard className="w-4 h-4 text-blue-400 stroke-[2.5]" />
            <span>{showManualInput ? 'Ocultar Digitação' : 'Digitar Código / EAN'}</span>
          </button>
        </div>

        {/* Manual Input Form */}
        {showManualInput && (
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              id="input-manual-ean-scanner"
              type="text"
              inputMode="numeric"
              placeholder="Digite o EAN ou Cód. Interno..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              className="flex-1 bg-gray-950 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:border-blue-500 font-mono font-bold"
              autoFocus
            />
            <button
              id="btn-submit-manual-ean"
              type="submit"
              className="bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white px-4 py-2 rounded-lg font-black uppercase text-xs flex items-center gap-1 shrink-0"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>OK</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
