import {
  Check,
  Clock,
  Copy,
  QrCode,
  RefreshCw,
  Smartphone,
  X
} from 'lucide-react';
import QRCode from 'qrcode';
import React, { useEffect, useState } from 'react';
import { promotorService } from '../../services/promotorService';
import { formatarSetoresExibicao, getPromotorSetores, Promotor, VinculoPromotor } from '../../types';
import { ConfirmacaoModal } from './ConfirmacaoModal';

interface GerarVinculoModalProps {
  isOpen: boolean;
  onClose: () => void;
  promotor: Promotor | null;
  onSuccess?: () => void;
}

export const GerarVinculoModal: React.FC<GerarVinculoModalProps> = ({
  isOpen,
  onClose,
  promotor,
  onSuccess,
}) => {
  const [vinculo, setVinculo] = useState<VinculoPromotor | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiado, setCopiado] = useState(false);
  const [tempoRestante, setTempoRestante] = useState<string>('30:00');
  const [isLoading, setIsLoading] = useState(false);
  const [isCancelarConfirmOpen, setIsCancelarConfirmOpen] = useState(false);
  const [isSimulando, setIsSimulando] = useState(false);

  // Carrega ou gera o vínculo ativo para o promotor selecionado
  useEffect(() => {
    if (!isOpen || !promotor) {
      setVinculo(null);
      setQrCodeDataUrl('');
      return;
    }

    const carregarOuGerar = async () => {
      setIsLoading(true);
      try {
        let v = promotorService.getVinculoAtivoByPromotor(promotor.promotorId);
        if (!v) {
          v = await promotorService.gerarVinculo(promotor.promotorId);
        }
        setVinculo(v);

        // Gera QR Code SVG/PNG a partir do token único de vínculo
        // Não contém senhas ou credenciais de banco, apenas o linkTokenId seguro
        const payloadQr = JSON.stringify({
          app: 'CONTROLE_VENCIMENTOS_PROMOTOR',
          v: 1,
          token: v.tokenVinculo,
          cod: v.codigoVinculo,
          filial: v.filialId,
          setor: v.setorId,
          setores: v.setores || (v.setorId === 'AMBOS' ? ['FRIOS', 'LOJA'] : [v.setorId]),
          agencia: v.agenciaNome || '',
        });

        const url = await QRCode.toDataURL(payloadQr, {
          width: 256,
          margin: 2,
          color: {
            dark: '#1e3a8a', // Dark blue
            light: '#ffffff',
          },
        });
        setQrCodeDataUrl(url);
      } catch (err) {
        console.error('Erro ao gerar vínculo:', err);
      } finally {
        setIsLoading(false);
      }
    };

    carregarOuGerar();
  }, [isOpen, promotor]);

  // Atualiza cronômetro de validade
  useEffect(() => {
    if (!vinculo) return;

    const interval = setInterval(() => {
      const exp = new Date(vinculo.dataExpiracao).getTime();
      const agora = Date.now();
      const diff = exp - agora;

      if (diff <= 0) {
        setTempoRestante('EXPIRADO');
        clearInterval(interval);
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTempoRestante(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [vinculo]);

  const handleCopiarCodigo = () => {
    if (!vinculo?.codigoVinculo) return;
    navigator.clipboard.writeText(vinculo.codigoVinculo);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const handleGerarNovoCodigo = async () => {
    if (!promotor) return;
    setIsLoading(true);
    try {
      const novo = await promotorService.gerarVinculo(promotor.promotorId);
      setVinculo(novo);

      const payloadQr = JSON.stringify({
        app: 'CONTROLE_VENCIMENTOS_PROMOTOR',
        v: 1,
        token: novo.tokenVinculo,
        cod: novo.codigoVinculo,
        filial: novo.filialId,
        setor: novo.setorId,
        setores: novo.setores || (novo.setorId === 'AMBOS' ? ['FRIOS', 'LOJA'] : [novo.setorId]),
        agencia: novo.agenciaNome || '',
      });

      const url = await QRCode.toDataURL(payloadQr, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1e3a8a',
          light: '#ffffff',
        },
      });
      setQrCodeDataUrl(url);
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar novo código.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelarVinculo = async () => {
    if (!vinculo) return;
    await promotorService.cancelarVinculo(vinculo.vinculoId);
    onClose();
    if (onSuccess) onSuccess();
  };

  const handleSimularConexaoApp = async () => {
    if (!vinculo) return;
    setIsSimulando(true);
    try {
      await promotorService.simularConclusaoVinculo(vinculo.vinculoId, {
        id: `device_${Math.random().toString(36).substring(2, 8)}`,
        nome: `Smartphone Samsung Galaxy A54 (Filial ${vinculo.filialId})`,
      });
      alert(`Dispositivo vinculado com sucesso para ${vinculo.promotorNome}! Status atualizado para ATIVO.`);
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      alert(err.message || 'Erro ao simular conexão.');
    } finally {
      setIsSimulando(false);
    }
  };

  if (!isOpen || !promotor) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
        <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-gray-100 pb-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                VÍNCULO DE ACESSO AO APP
              </span>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <h2 className="text-lg font-black text-gray-900 uppercase tracking-tight">
                  {promotor.nome}
                </h2>
                {promotor.agenciaNome && (
                  <span className="text-xs font-bold text-blue-800 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-200">
                    {promotor.agenciaNome}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 font-medium mt-0.5">
                Filial {promotor.filialId} ({promotor.filialNome}) • Setor: <strong>{formatarSetoresExibicao(getPromotorSetores(promotor))}</strong>
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Status Badge */}
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 px-3.5 py-2.5 rounded-xl">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-black text-amber-900 uppercase">
                STATUS: AGUARDANDO VÍNCULO
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs font-mono font-black text-amber-800">
              <Clock className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{tempoRestante}</span>
            </div>
          </div>

          {/* Código de 6 Dígitos */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-center space-y-2">
            <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider">
              CÓDIGO DE VINCULAÇÃO (6 DÍGITOS)
            </span>
            <div className="flex items-center justify-center gap-2">
              <span className="text-3xl sm:text-4xl font-mono font-black tracking-widest text-blue-900 bg-white px-5 py-2 rounded-xl border border-blue-200 shadow-2xs">
                {vinculo ? vinculo.codigoVinculo.split('').join(' ') : '------'}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 font-medium">
              Digite este código no aplicativo de campo do promotor para autenticar.
            </p>
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={handleCopiarCodigo}
                className="px-3.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiado ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                    <span className="text-emerald-700">CÓDIGO COPIADO!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-blue-700 stroke-[2.5]" />
                    <span>COPIAR CÓDIGO</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* QR Code Container */}
          <div className="bg-white rounded-xl p-4 border border-gray-200 text-center space-y-2.5">
            <div className="flex items-center justify-center gap-1.5 text-xs font-black text-gray-700 uppercase tracking-wide">
              <QrCode className="w-4 h-4 text-blue-700 stroke-[2.5]" />
              <span>OU ESCANEIE O QR CODE</span>
            </div>

            <div className="flex items-center justify-center p-2 bg-gray-50 rounded-xl border border-gray-100 max-w-[220px] mx-auto min-h-[200px]">
              {isLoading ? (
                <div className="flex flex-col items-center gap-2 py-8 text-gray-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-700" />
                  <span className="text-xs font-medium">Gerando QR Code...</span>
                </div>
              ) : qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt="QR Code de Vinculação"
                  className="w-48 h-48 rounded-lg shadow-2xs"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="text-xs text-gray-400">Indisponível</span>
              )}
            </div>

            <p className="text-[11px] text-gray-500 font-medium">
              Válido por 30 minutos a partir da geração. Uso único e intransferível.
            </p>
          </div>

          {/* Botão de Teste / Demonstração (Permite testar a vinculação sem app de campo) */}
          <div className="bg-blue-50/70 rounded-xl p-3 border border-blue-200 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-blue-700 shrink-0 stroke-[2.5]" />
              <div>
                <p className="text-xs font-black text-blue-900 uppercase">
                  Simular Leitura do Promotor
                </p>
                <p className="text-[10px] text-blue-700 font-medium">
                  Ativa o dispositivo imediatamente para testes no preview
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSimularConexaoApp}
              disabled={isSimulando || !vinculo || vinculo.status !== 'AGUARDANDO'}
              className="px-2.5 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-black uppercase tracking-wider transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
            >
              {isSimulando ? 'Ativando...' : 'Testar Conexão'}
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setIsCancelarConfirmOpen(true)}
              className="px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-rose-700 hover:bg-rose-50 border border-rose-200 transition-colors cursor-pointer"
            >
              Cancelar Vínculo
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGerarNovoCodigo}
                disabled={isLoading}
                className="px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Gerar Novo</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmacaoModal
        isOpen={isCancelarConfirmOpen}
        onClose={() => setIsCancelarConfirmOpen(false)}
        onConfirm={handleCancelarVinculo}
        titulo="Cancelar Vínculo"
        mensagem="Tem certeza de que deseja cancelar este código e QR Code de vinculação? O código deixará de ser válido imediatamente."
        textoConfirmar="Sim, Cancelar Vínculo"
        tipoPerigo={true}
      />
    </>
  );
};
