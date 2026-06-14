import Reveal from './Reveal';

const PILLARS = [
  {
    k: '01',
    t: 'Identity',
    d: 'An ENS name — agent-a.boa.eth — is the agent’s account handle and its public, third-party-auditable trail.',
    tag: 'ENS',
  },
  {
    k: '02',
    t: 'Access membership',
    d: 'An ERC-7527 voucher: a transferable, FOAMM-priced claim on future inference, struck at today’s terms.',
    tag: 'ERC-7527',
  },
  {
    k: '03',
    t: 'Payment rail',
    d: 'One USDC balance settled over Arc. Deposit, get usable quota — permissionless, no signup, no KYC.',
    tag: 'Arc · USDC',
  },
  {
    k: '04',
    t: 'Verifiable usage receipts',
    d: 'Every call is metered and its digest is written to an immutable ledger on ENS records and Hedera.',
    tag: 'Hedera · ENS',
  },
];

export default function Pillars() {
  return (
    <section className="pillars" id="pillars">
      <Reveal>
        <p className="section__eyebrow">One account · four primitives</p>
        <h2 className="section__h">Everything an agent needs to hold a balance, spend it, and prove it.</h2>
      </Reveal>
      <Reveal stagger className="pillars__grid">
        {PILLARS.map((p) => (
          <article className="pillar" key={p.k}>
            <span className="pillar__k">{p.k}</span>
            <h3 className="pillar__t">{p.t}</h3>
            <p className="pillar__d">{p.d}</p>
            <span className="pillar__tag">{p.tag}</span>
          </article>
        ))}
      </Reveal>
    </section>
  );
}
