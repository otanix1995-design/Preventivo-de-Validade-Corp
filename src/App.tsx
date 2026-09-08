import React, { useEffect, useState } from 'react';
import { BarcodeScannerModal } from './components/BarcodeScannerModal';
import { BottomNav, NavTab } from './components/BottomNav';
import { CadastrarVencimentoModal } from './components/CadastrarVencimentoModal';
import { ConsultaView } from './components/ConsultaView';
import { DashboardView } from './components/DashboardView';
import { DivergenciasView } from './components/DivergenciasView';
import { EansVinculadosView } from './components/EansVinculadosView';
import { Header } from './components/Header';
import { ImportacaoView } from './components/ImportacaoView';
import { MaisMenuView } from './components/MaisMenuView';
import { PromotoresView } from './components/PromotoresView';
import { RelatoriosView } from './components/RelatoriosView';
import { Saeou060View } from './components/Saeou060View';
import { SelecionarProdutoCadastroModal } from './components/SelecionarProdutoCadastroModal';
import { SemVendaView } from './components/SemVendaView';
import { VencimentosView } from './components/VencimentosView';
import { VincularEanModal } from './components/VincularEanModal';
import {
  findProdutoByCodeOrEan,
  getDivergencias,
  getMetadados,
  getProdutos,
  getVencimentos,
  getVinculosEan,
  initStorage,
  subscribeToStore
} from './services/storage';
import { DivergenciaRegistro, LoteVencimento, MetadadosBase, ProdutoSMG, VinculoEan } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [subView, setSubView] = useState<string | null>(null);

  // Core reactive data states
  const [produtos, setProdutos] = useState<ProdutoSMG[]>(() => getProdutos());
  const [vencimentos, setVencimentos] = useState<LoteVencimento[]>(() => getVencimentos());
  const [vinculosEan, setVinculosEan] = useState<VinculoEan[]>(() => getVinculosEan());
  const [divergencias, setDivergencias] = useState<DivergenciaRegistro[]>(() => getDivergencias());
  const [metadados, setMetadados] = useState<MetadadosBase>(() => getMetadados());

  // Interactive modal states
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'consulta' | 'cadastrar' | 'vincular' | null>(null);
  const [isSelectProdutoModalOpen, setIsSelectProdutoModalOpen] = useState(false);
  const [isCadastrarModalOpen, setIsCadastrarModalOpen] = useState(false);
  const [modalProduto, setModalProduto] = useState<ProdutoSMG | null>(null);
  const [modalLoteParaEditar, setModalLoteParaEditar] = useState<LoteVencimento | null>(null);
  const [scannedEanUsed, setScannedEanUsed] = useState<string | undefined>(undefined);

  // Vincular EAN Manual modal state
  const [isVincularModalOpen, setIsVincularModalOpen] = useState(false);
  const [vincularInitialEan, setVincularInitialEan] = useState<string | undefined>(undefined);
  const [vincularInitialProduto, setVincularInitialProduto] = useState<ProdutoSMG | null>(null);

  // Selected product detail view state
  const [selectedProduto, setSelectedProduto] = useState<ProdutoSMG | null>(null);
  const [initialSearchQuery, setInitialSearchQuery] = useState<string>('');
  const [initialVencimentoFilter, setInitialVencimentoFilter] = useState<string>('TODOS');
  const [initialVencimentoSubTab, setInitialVencimentoSubTab] = useState<'controle' | 'saeou060'>('controle');

  // Sync state when store updates and on init
  useEffect(() => {
    initStorage().then(() => {
      setProdutos(getProdutos());
      setVencimentos(getVencimentos());
      setVinculosEan(getVinculosEan());
      setDivergencias(getDivergencias());
      setMetadados(getMetadados());
    });

    const unsubscribe = subscribeToStore(() => {
      setProdutos(getProdutos());
      setVencimentos(getVencimentos());
      setVinculosEan(getVinculosEan());
      setDivergencias(getDivergencias());
      setMetadados(getMetadados());
    });

    return () => unsubscribe();
  }, []);

  // Handle Bottom Nav or Action Card Navigation
  const handleTabChange = (tab: NavTab, filterOrSub?: string) => {
    if (tab === 'cadastrar') {
      setIsSelectProdutoModalOpen(true);
      return;
    }

    setActiveTab(tab);

    if (tab === 'vencimentos') {
      if (filterOrSub === 'saeou060') {
        setInitialVencimentoSubTab('saeou060');
      } else if (filterOrSub) {
        setInitialVencimentoSubTab('controle');
        setInitialVencimentoFilter(filterOrSub);
      } else {
        setInitialVencimentoSubTab('controle');
      }
      setSubView(null);
    } else if (tab === 'mais' && filterOrSub) {
      setSubView(filterOrSub);
    } else {
      setSubView(null);
    }
  };

  // Handle Open Vincular EAN Modal
  const handleOpenVincularModal = (ean?: string, prod?: ProdutoSMG | null) => {
    setVincularInitialEan(ean);
    setVincularInitialProduto(prod || null);
    setIsVincularModalOpen(true);
  };

  // Handle Successful Camera Scan
  const handleBarcodeScan = (scannedCode: string) => {
    setScannedEanUsed(scannedCode);
    const currentMode = scannerMode;
    setScannerMode(null);

    // If scan was initiated directly from the Vincular EAN modal, re-open modal with scanned code
    if (currentMode === 'vincular') {
      setVincularInitialEan(scannedCode);
      setIsVincularModalOpen(true);
      return;
    }

    const found = findProdutoByCodeOrEan(scannedCode);

    if (found) {
      if (currentMode === 'cadastrar') {
        handleOpenCadastrarForProduto(found);
      } else {
        setSelectedProduto(found);
        setActiveTab('consulta');
        setInitialSearchQuery('');
      }
    } else {
      // Not found directly: Open Consulta search with the scanned string and open Vincular modal
      setSelectedProduto(null);
      setInitialSearchQuery(scannedCode);
      setActiveTab('consulta');
      handleOpenVincularModal(scannedCode);
    }
  };

  const handleOpenCadastrarForProduto = (prod: ProdutoSMG, lote?: LoteVencimento | null) => {
    setModalProduto(prod);
    setModalLoteParaEditar(lote || null);
    setIsCadastrarModalOpen(true);
  };

  const handleSelectProdutoByCodigo = (codigoInterno: string) => {
    const found = produtos.find((p) => p.codigo_interno === codigoInterno);
    if (found) {
      setSelectedProduto(found);
      setActiveTab('consulta');
      setSubView(null);
    }
  };

  // Calculate dynamic count of items requiring immediate attention for bottom nav badge
  const badgeVencimentosCriticos = vencimentos.filter((v) => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const val = new Date(v.data_validade + 'T00:00:00');
    val.setHours(0, 0, 0, 0);
    const diff = Math.floor((val.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    return diff <= 3 || v.enviar_ao_comprador;
  }).length;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col font-sans antialiased selection:bg-blue-600 selection:text-white">
      {/* 1. Header (Deep Blue, Official Filial 172 Branding, Quick Scan button) */}
      <Header
        filial="FILIAL 172 - CASCAVEL"
        statusBase={metadados.status_base}
        metadados={metadados}
        onOpenScanner={() => setIsScannerOpen(true)}
      />

      {/* 2. Main Content Container */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-3.5 sm:px-6 pt-4 pb-20">
        {/* TAB: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <DashboardView
            metadados={metadados}
            produtos={produtos}
            vencimentos={vencimentos}
            divergencias={divergencias}
            onNavigate={handleTabChange}
            onOpenScanner={() => {
              setScannerMode('consulta');
              setIsScannerOpen(true);
            }}
            onSelectProduto={(prod) => {
              setSelectedProduto(prod);
              setActiveTab('consulta');
            }}
            onCadastrarDireto={() => {
              setIsSelectProdutoModalOpen(true);
            }}
          />
        )}

        {/* TAB: CONSULTA */}
        {activeTab === 'consulta' && (
          <ConsultaView
            produtos={produtos}
            initialSearchQuery={initialSearchQuery}
            selectedProduto={selectedProduto}
            onSelectProduto={setSelectedProduto}
            onOpenScanner={() => {
              setScannerMode('consulta');
              setIsScannerOpen(true);
            }}
            onOpenCadastrarModal={handleOpenCadastrarForProduto}
            onOpenVincularModal={handleOpenVincularModal}
          />
        )}

        {/* TAB: VENCIMENTOS */}
        {activeTab === 'vencimentos' && (
          <VencimentosView
            vencimentos={vencimentos}
            produtos={produtos}
            initialFilter={initialVencimentoFilter}
            initialSubTab={initialVencimentoSubTab}
            onSelectProduto={(prod) => {
              setSelectedProduto(prod);
              setActiveTab('consulta');
            }}
            onOpenCadastrarModal={(prod, lote) => {
              if (prod) {
                handleOpenCadastrarForProduto(prod, lote);
              } else if (produtos.length > 0) {
                handleOpenCadastrarForProduto(produtos[0], lote);
              }
            }}
          />
        )}

        {/* TAB: MAIS (Menu & Sub-Views) */}
        {activeTab === 'mais' && (
          <>
            {subView === 'promotores' && (
              <PromotoresView onBack={() => setSubView(null)} />
            )}

            {subView === 'saeou060' && (
              <div className="space-y-3">
                <button
                  onClick={() => setSubView(null)}
                  className="text-xs font-bold text-blue-700 hover:underline flex items-center gap-1"
                >
                  ← Voltar para Menu Mais
                </button>
                <Saeou060View
                  onSelectProduto={(prod) => {
                    setSelectedProduto(prod);
                    setActiveTab('consulta');
                    setSubView(null);
                  }}
                  onNavigateToVencimentos={() => {
                    setActiveTab('vencimentos');
                    setSubView(null);
                  }}
                />
              </div>
            )}

            {subView === 'importacao' && (
              <div className="space-y-3">
                <button
                  onClick={() => setSubView(null)}
                  className="text-xs font-bold text-blue-700 hover:underline flex items-center gap-1"
                >
                  ← Voltar para Menu Mais
                </button>
                <ImportacaoView
                  metadados={metadados}
                  onNavigateToSaeou060={() => setSubView('saeou060')}
                  onImportComplete={() => {
                    setProdutos(getProdutos());
                    setVencimentos(getVencimentos());
                    setVinculosEan(getVinculosEan());
                  }}
                />
              </div>
            )}

            {subView === 'eans' && (
              <div className="space-y-3">
                <button
                  onClick={() => setSubView(null)}
                  className="text-xs font-bold text-blue-700 hover:underline flex items-center gap-1"
                >
                  ← Voltar para Menu Mais
                </button>
                <EansVinculadosView
                  vinculos={vinculosEan}
                  produtos={produtos}
                  onSelectProdutoByCodigo={handleSelectProdutoByCodigo}
                  onNavigateToImport={() => setSubView('importacao')}
                  onOpenVincularModal={handleOpenVincularModal}
                />
              </div>
            )}

            {subView === 'sem_venda' && (
              <div className="space-y-3">
                <button
                  onClick={() => setSubView(null)}
                  className="text-xs font-bold text-blue-700 hover:underline flex items-center gap-1"
                >
                  ← Voltar para Menu Mais
                </button>
                <SemVendaView
                  produtos={produtos}
                  onSelectProduto={(prod) => {
                    setSelectedProduto(prod);
                    setActiveTab('consulta');
                    setSubView(null);
                  }}
                  onOpenCadastrarModal={handleOpenCadastrarForProduto}
                />
              </div>
            )}

            {subView === 'divergencias' && (
              <div className="space-y-3">
                <button
                  onClick={() => setSubView(null)}
                  className="text-xs font-bold text-blue-700 hover:underline flex items-center gap-1"
                >
                  ← Voltar para Menu Mais
                </button>
                <DivergenciasView
                  divergencias={divergencias}
                  produtos={produtos}
                  onSelectProdutoByCodigo={handleSelectProdutoByCodigo}
                />
              </div>
            )}

            {subView === 'relatorios' && (
              <div className="space-y-3">
                <button
                  onClick={() => setSubView(null)}
                  className="text-xs font-bold text-blue-700 hover:underline flex items-center gap-1"
                >
                  ← Voltar para Menu Mais
                </button>
                <RelatoriosView
                  vencimentos={vencimentos}
                  produtos={produtos}
                />
              </div>
            )}

            {!subView && (
              <MaisMenuView
                metadados={metadados}
                onNavigateSub={(sub) => setSubView(sub)}
                onRefreshData={() => {
                  setProdutos(getProdutos());
                  setVencimentos(getVencimentos());
                  setVinculosEan(getVinculosEan());
                  setDivergencias(getDivergencias());
                  setMetadados(getMetadados());
                }}
              />
            )}
          </>
        )}
      </main>

      {/* 3. Mobile Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => handleTabChange(tab)}
        badgeCount={badgeVencimentosCriticos}
      />

      {/* 4. Barcode Camera Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => {
          setIsScannerOpen(false);
          // If scanner was closed without scanning during vincular, restore Vincular modal
          if (scannerMode === 'vincular') {
            setIsVincularModalOpen(true);
          }
          setScannerMode(null);
        }}
        onScan={handleBarcodeScan}
      />

      {/* 5. Selecionar Produto para Cadastrar (Manual ou Scanner) */}
      <SelecionarProdutoCadastroModal
        isOpen={isSelectProdutoModalOpen}
        onClose={() => setIsSelectProdutoModalOpen(false)}
        onSelectProduto={(prod) => {
          setIsSelectProdutoModalOpen(false);
          handleOpenCadastrarForProduto(prod);
        }}
        onOpenScanner={() => {
          setIsSelectProdutoModalOpen(false);
          setScannerMode('cadastrar');
          setIsScannerOpen(true);
        }}
      />

      {/* 6. Cadastrar Vencimento Modal */}
      <CadastrarVencimentoModal
        isOpen={isCadastrarModalOpen}
        onClose={() => {
          setIsCadastrarModalOpen(false);
          setModalProduto(null);
          setModalLoteParaEditar(null);
          setScannedEanUsed(undefined);
        }}
        produto={modalProduto}
        loteParaEditar={modalLoteParaEditar}
        eanConsultado={scannedEanUsed}
        onChangeProduto={() => {
          setIsCadastrarModalOpen(false);
          setModalProduto(null);
          setModalLoteParaEditar(null);
          setIsSelectProdutoModalOpen(true);
        }}
        onSuccess={() => {
          setVencimentos(getVencimentos());
          // Switch to vencimentos tab to see the saved lot
          setActiveTab('vencimentos');
        }}
      />

      {/* 7. Vincular EAN Modal */}
      <VincularEanModal
        isOpen={isVincularModalOpen}
        onClose={() => {
          setIsVincularModalOpen(false);
          setVincularInitialEan(undefined);
          setVincularInitialProduto(null);
        }}
        initialEan={vincularInitialEan}
        initialProduto={vincularInitialProduto}
        onOpenScanner={(currentProd) => {
          if (currentProd) {
            setVincularInitialProduto(currentProd);
          }
          setIsVincularModalOpen(false);
          setScannerMode('vincular');
          setIsScannerOpen(true);
        }}
        onSuccess={(prod, linkedEan) => {
          setSelectedProduto(prod);
          setProdutos(getProdutos());
          setVinculosEan(getVinculosEan());
          setActiveTab('consulta');
        }}
      />
    </div>
  );
}
