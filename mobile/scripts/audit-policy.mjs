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

function hasReviewedStreamJsonPath(lockfile) {
  const packages = lockfile?.packages;
  if (!packages || packages['node_modules/stream-json']?.version !== '1.9.1') {
    return false;
  }

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
