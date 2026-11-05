import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Termos de uso' };

/* Texto-base: o operador da plataforma deve revisar com assessoria jurídica antes da produção. */
export default function TermsPage() {
  return (
    <LegalPage title="Termos de uso" updated="5 de novembro de 2026">
      <p>Ao criar uma conta no Balcão, o estabelecimento concorda com estas condições.</p>
      <h2>O serviço</h2>
      <p>O Balcão oferece cardápio digital, recebimento e gestão de pedidos, gestão de equipe e indicadores de vendas. Novos módulos podem ser incluídos ao longo do tempo.</p>
      <h2>Responsabilidades do estabelecimento</h2>
      <ul>
        <li>Manter preços, produtos, horários e informações do cardápio corretos e atualizados.</li>
        <li>Cumprir as regras de defesa do consumidor, vigilância sanitária e tributárias aplicáveis ao seu negócio.</li>
        <li>Tratar os dados dos clientes de acordo com a LGPD e apenas para atender os pedidos ou com consentimento.</li>
        <li>Conferir os pagamentos recebidos antes de considerá-los confirmados.</li>
        <li>Cuidar do acesso da sua equipe, removendo quem não trabalha mais na loja.</li>
      </ul>
      <h2>Conta e segurança</h2>
      <p>O acesso é pessoal. Cada pessoa da equipe deve ter seu próprio login. Ações feitas no painel ficam registradas.</p>
      <h2>Disponibilidade</h2>
      <p>Trabalhamos para manter o serviço disponível, mas podem ocorrer interrupções para manutenção ou por falhas de terceiros.</p>
      <h2>Encerramento</h2>
      <p>O estabelecimento pode encerrar a conta quando quiser. Contas usadas para fraude ou em desacordo com a lei podem ser suspensas.</p>
    </LegalPage>
  );
}
