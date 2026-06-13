/**
 * Loads the *real* ENS contract artifacts (ABI + deploy bytecode) that ship
 * compiled inside `@ensdomains/ens-contracts`. We deploy these verbatim onto a
 * local in-process chain so the write/read-back proof exercises the genuine ENS
 * registry + public resolver code paths — no funds, no testnet, no mocks.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

type Artifact = { abi: any[]; bytecode: `0x${string}` };

function loadArtifact(pkgPath: string): Artifact {
  const file = require.resolve(pkgPath);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (!json.abi || !json.bytecode) {
    throw new Error(`artifact ${pkgPath} is missing abi/bytecode`);
  }
  return { abi: json.abi, bytecode: json.bytecode as `0x${string}` };
}

export const ENSRegistry = loadArtifact(
  '@ensdomains/ens-contracts/artifacts/contracts/registry/ENSRegistry.sol/ENSRegistry.json',
);

// OwnedResolver is the real ENS resolver profile (Addr + Text + ...) gated by a
// single contract owner instead of a trusted reverse-registrar. Its no-arg
// constructor lets us deploy it standalone on a bare registry, while still
// exercising the genuine addr()/text()/setAddr()/setText() resolution path.
export const OwnedResolver = loadArtifact(
  '@ensdomains/ens-contracts/artifacts/contracts/resolvers/OwnedResolver.sol/OwnedResolver.json',
);
