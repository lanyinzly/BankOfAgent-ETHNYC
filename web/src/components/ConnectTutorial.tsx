// Bottom-of-page tutorial: how to give your agent an ENS identity via the
// "Connect your agent" panel (bottom-right). Static, design-system friendly.
import './connectTutorial.css';

const STEPS = [
  {
    n: 1,
    title: 'Open “Connect your agent”',
    body: 'Bottom-right of the screen. Create a fresh agent wallet in one click, or connect an injected wallet (address only — no signing needed).',
  },
  {
    n: 2,
    title: 'Name it · get a gasless ENS',
    body: 'Type a name and hit “Create ENS · gasless”. BoA mints a real subname under the fleet root on Sepolia and writes its records — the platform signs, so you pay 0 gas.',
  },
  {
    n: 3,
    title: 'It resolves on-chain',
    body: 'Your agent now has a verifiable identity — name.<fleet>.eth → your wallet, re-resolved live on-chain and viewable on the ENS app.',
  },
  {
    n: 4,
    title: 'Optional · claim self-custody',
    body: 'One click hands registry ownership of the name to the agent’s own wallet (still 0 gas for you). From then on, only the agent controls it.',
  },
];

export default function ConnectTutorial() {
  return (
    <section className="ctut" id="connect-tutorial">
      <div className="ctut__head">
        <p className="ctut__kicker">Get started</p>
        <h2 className="ctut__title">Connect your agent</h2>
        <p className="ctut__sub">
          Give any agent a portable, on-chain identity in under a minute — gasless. A default agent is
          already connected so you can explore; spin up your own from the panel in the bottom-right.
        </p>
      </div>
      <ol className="ctut__steps">
        {STEPS.map((s) => (
          <li key={s.n} className="ctut__step">
            <span className="ctut__num">{s.n}</span>
            <div>
              <div className="ctut__stepTitle">{s.title}</div>
              <p className="ctut__stepBody">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
