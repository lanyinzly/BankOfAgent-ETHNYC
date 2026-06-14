import Reveal from './Reveal';

export default function Explainer() {
  return (
    <section className="explain" id="about">
      <Reveal>
        <p className="section__eyebrow">What is Bank of Agent</p>
        <h2 className="explain__h">
          Inference is the largest new commodity of the decade — but it still trades like a phone plan.
        </h2>
      </Reveal>

      <Reveal stagger className="explain__cols">
        <p className="explain__p">
          No unit of account. No transferable right. No forward price. No verifiable delivery. A
          commodity you can’t price forward or audit independently isn’t a market — it’s a
          subscription.
        </p>
        <p className="explain__p">
          BoA gives compute the four things every exchange has: a <b>unit of account</b> (USDC quota),
          a <b>spot price</b> (metered per call), a <b>forward curve</b> (FOAMM-priced ERC-7527
          vouchers), and <b>verifiable delivery</b> (usage digests on ENS + Hedera).
        </p>
      </Reveal>

      <Reveal>
        <p className="explain__thesis">
          “A mechanism for discovering what agent compute is <em>worth</em> — where human and agent
          enthusiasm is an <em>input</em> to that price, not just an after-effect.”
        </p>
      </Reveal>

      <Reveal className="cite">
        <span>
          Membership vouchers implement <b>ERC-7527</b> — the standard for FOAMM-priced claims on
          future compute.
        </span>
        <a className="cite__link" href="https://erc7527.com" target="_blank" rel="noreferrer">
          erc7527.com →
        </a>
      </Reveal>
    </section>
  );
}
