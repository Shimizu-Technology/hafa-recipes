const acceptedSimpleAdvisories = new Set([
  // Expo/Metro build-time image metadata parsing; app inputs do not reach it.
  'image-size:1138808',
  'image-size:1138809',
  // Expo/Metro CSS build pipeline; only trusted repository CSS is processed.
  'postcss:1117015',
  'postcss:1124252',
  'postcss:1130709',
  'postcss:1139510',
  // Build tooling and Clerk's unused wallet dependency path; app code does not
  // call UUID v3/v5/v6 with caller-controlled output buffers.
  'uuid:1119441',
]);

const STREAM_JSON_ADVISORY = 'stream-json:1164823';

const reviewedStreamJsonChain = [
  ['', 'dependencies', '@clerk/expo'],
  ['node_modules/@clerk/expo', 'dependencies', '@clerk/clerk-js'],
  ['node_modules/@clerk/clerk-js', 'dependencies', '@solana/wallet-adapter-base'],
  ['node_modules/@solana/wallet-adapter-base', 'peerDependencies', '@solana/web3.js'],
  ['node_modules/@solana/web3.js', 'dependencies', 'jayson'],
  ['node_modules/jayson', 'dependencies', 'stream-json'],
];

const reviewedStreamJsonPackages = {
  'node_modules/@clerk/expo': {
    version: '4.5.2',
    integrity: 'sha512-sdvcXJ9dPIaZaGTM8clxyQCwpEYuL4mSBnMoXLoOKzHPKSxeW6Y4FQqQbiT/Rr954cUKAjeFYD4oPSboP9yWog==',
  },
  'node_modules/@clerk/clerk-js': {
    version: '6.29.3',
    integrity: 'sha512-CfamNIf04jhwAMr4+tMI/ZOXj04Tep725cTrnz/Ve6PtjAFzS2XkYlOPjiBA9yfk8gYMbuI4zZeAklbs84UC8g==',
  },
  'node_modules/@solana/wallet-adapter-base': {
    version: '0.9.27',
    integrity: 'sha512-kXjeNfNFVs/NE9GPmysBRKQ/nf+foSaq3kfVSeMcO/iVgigyRmB551OjU3WyAolLG/1jeEfKLqF9fKwMCRkUqg==',
  },
  'node_modules/@solana/web3.js': {
    version: '1.98.4',
    integrity: 'sha512-vv9lfnvjUsRiq//+j5pBdXig0IQdtzA0BRZ3bXEP4KaIyF1CcaydWqgyzQgfZMNIsWNWmG+AUHwPy4AHOD6gpw==',
  },
  'node_modules/jayson': {
    version: '4.3.0',
    integrity: 'sha512-AauzHcUcqs8OBnCHOkJY280VaTiCm57AbuO7lqzcw7JapGj50BisE3xhksye4zlTSR1+1tAz67wLTl8tEH1obQ==',
  },
  'node_modules/stream-json': {
    version: '1.9.1',
    integrity: 'sha512-uWkjJ+2Nt/LO9Z/JyKZbMusL8Dkh97uUBTv3AJQ74y07lVahLY4eEFsPsE97pxYBwr8nnjMAIch5eqI0gPShyw==',
  },
};

function hasReviewedStreamJsonPath(lockfile) {
  const packages = lockfile?.packages;
  if (!packages) return false;

  const metadataMatches = Object.entries(reviewedStreamJsonPackages).every(
    ([packagePath, expected]) =>
      packages[packagePath]?.version === expected.version
      && packages[packagePath]?.integrity === expected.integrity,
  );
  if (!metadataMatches) return false;

  const chainExists = reviewedStreamJsonChain.every(
    ([packagePath, dependencyKind, dependencyName]) =>
      typeof packages[packagePath]?.[dependencyKind]?.[dependencyName] === 'string',
  );
  if (!chainExists) return false;

  // A deduplicated package can serve several parents. Accept it only while the
  // reviewed Clerk/Solana chain is its sole declaration in the production tree.
  const declaringPackages = Object.entries(packages)
    .filter(([, metadata]) =>
      ['dependencies', 'optionalDependencies', 'peerDependencies'].some(
        (kind) => typeof metadata?.[kind]?.['stream-json'] === 'string',
      ))
    .map(([packagePath]) => packagePath);

  return declaringPackages.length === 1
    && declaringPackages[0] === 'node_modules/jayson';
}

export const reviewedAdvisoryCount = acceptedSimpleAdvisories.size + 1;

export function isAcceptedAdvisory({ packageName, source, lockfile }) {
  const key = `${packageName}:${source}`;
  if (acceptedSimpleAdvisories.has(key)) return true;
  if (key !== STREAM_JSON_ADVISORY) return false;

  // Clerk bundles unused Solana wallet support in the native SDK. Håfa does
  // not expose that path, and its JSON filter receives no app or user input.
  return hasReviewedStreamJsonPath(lockfile);
}
