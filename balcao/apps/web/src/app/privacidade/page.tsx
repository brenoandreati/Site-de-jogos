import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Política de privacidade' };

/*
 * Texto-base. O operador da plataforma deve revisá-lo com assessoria jurídica e preencher
 * os dados do controlador e do encarregado (DPO) antes de colocar a plataforma em produção.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade" updated="5 de novembro de 2026">
      <p>
        Esta política explica quais dados pessoais o Balcão trata, para quê e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
      </p>
      <h2>Quem trata os dados</h2>
      <p>
        Cada estabelecimento que usa o Balcão é o controlador dos dados dos seus clientes e da sua equipe. A plataforma atua como operadora, guardando e processando esses dados para que o estabelecimento receba e gerencie pedidos.
      </p>
      <h2>Dados de quem faz pedidos</h2>
      <ul>
        <li>Nome, telefone (WhatsApp) e, para entrega, endereço: usados para preparar, entregar e falar sobre o pedido.</li>
        <li>Itens, valores, forma de pagamento e observações do pedido: usados para atender o pedido e para o histórico da loja.</li>
        <li>Consentimento para receber promoções: só é registrado quando você marca a opção no pedido, e pode ser revogado a qualquer momento falando com a loja.</li>
      </ul>
      <p>Seus dados de nome, telefone e endereço podem ficar salvos no seu próprio aparelho, se você escolher, para agilizar o próximo pedido.</p>
      <h2>Dados de quem usa o painel</h2>
      <ul>
        <li>Nome, e-mail e senha (guardada apenas como hash, nunca em texto).</li>
        <li>Registros de acesso e de alterações feitas no painel (data, horário e endereço IP), para segurança e auditoria.</li>
      </ul>
      <h2>Pagamentos</h2>
      <p>Nesta versão, os pagamentos são feitos diretamente à loja, na entrega ou na retirada. O Balcão não coleta nem guarda dados de cartão.</p>
      <h2>Compartilhamento</h2>
      <p>Os dados não são vendidos. São compartilhados apenas com o estabelecimento em que você fez o pedido e com provedores de infraestrutura necessários para o funcionamento do serviço (hospedagem e envio de e-mails).</p>
      <h2>Seus direitos</h2>
      <p>
        Você pode pedir confirmação, acesso, correção, anonimização, portabilidade ou eliminação dos seus dados, além de revogar consentimentos. Para dados de pedidos, fale com o estabelecimento. Para dados de conta do painel, use o contato do operador da plataforma.
      </p>
      <h2>Segurança e retenção</h2>
      <p>Usamos conexões criptografadas, controle de acesso por função, isolamento entre estabelecimentos e registros de auditoria. Os dados são mantidos enquanto forem necessários para a finalidade ou para cumprir obrigações legais.</p>
    </LegalPage>
  );
}
