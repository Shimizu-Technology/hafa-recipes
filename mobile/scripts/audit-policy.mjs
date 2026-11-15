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

// All three are constrained to the reviewed, unused native Clerk wallet tree.
const STREAM_JSON_ADVISORIES = new Set([
  'stream-json:1164823',
  'stream-json:1241262',
  'stream-json:1241263',
]);
const STREAM_JSON_REVIEW_STARTED = Date.parse('2026-10-24T00:00:00Z');
export const streamJsonReviewExpiresAt = '2027-01-15T00:00:00Z';
const STREAM_JSON_REVIEW_EXPIRES = Date.parse(streamJsonReviewExpiresAt);

const reviewedStreamJsonChain = [
  ['', 'dependencies', '@clerk/expo', '^4.5.2'],
  ['node_modules/@clerk/expo', 'dependencies', '@clerk/clerk-js', '^6.29.3'],
  ['node_modules/@clerk/clerk-js', 'dependencies', '@solana/wallet-adapter-base', '0.9.27'],
  ['node_modules/@solana/wallet-adapter-base', 'peerDependencies', '@solana/web3.js', '^1.98.0'],
  ['node_modules/@solana/web3.js', 'dependencies', 'jayson', '^4.1.1'],
  ['node_modules/jayson', 'dependencies', 'stream-json', '^1.9.1'],
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

function hasReviewedStreamJsonPath(lockfile, now) {
  const packages = lockfile?.packages;
  if (!packages || !Number.isFinite(now) || now < STREAM_JSON_REVIEW_STARTED
    || now >= STREAM_JSON_REVIEW_EXPIRES) return false;

  const metadataMatches = Object.entries(reviewedStreamJsonPackages).every(
    ([packagePath, expected]) =>
      packages[packagePath]?.version === expected.version
      && packages[packagePath]?.integrity === expected.integrity
      && !Object.keys(packages).some((candidate) =>
        candidate.endsWith(`/node_modules/${packagePath.slice('node_modules/'.length)}`)),
  );
  if (!metadataMatches) return false;

  const chainExists = reviewedStreamJsonChain.every(
    ([packagePath, dependencyKind, dependencyName, range]) =>
      ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'].every(
        (kind) => packages[packagePath]?.[kind]?.[dependencyName] === (kind === dependencyKind ? range : undefined)),
  );
  if (!chainExists) return false;

  // A deduplicated package can serve several parents. Accept it only while the
  // reviewed Clerk/Solana chain is its sole declaration in the production tree.
  const declaringPackages = Object.entries(packages)
    .filter(([, metadata]) =>
      ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'].some(
        (kind) => typeof metadata?.[kind]?.['stream-json'] === 'string',
      ))
    .map(([packagePath]) => packagePath);

  return declaringPackages.length === 1
    && declaringPackages[0] === 'node_modules/jayson';
}

// Temporary exceptions for build-tool, unused wallet and reachable Router
// advisories. These are not runtime vulnerability fixes; see ../docs/dependency-audit-review.md.
// Any changed version, integrity, declaring parent/range, duplicate install,
// or expired review fails closed and requires a fresh reachability assessment.
const BUILD_TOOL_REVIEW_STARTED = Date.parse('2026-10-24T00:00:00Z');
export const buildToolReviewExpiresAt = '2027-01-15T00:00:00Z';
const BUILD_TOOL_REVIEW_EXPIRES = Date.parse(buildToolReviewExpiresAt);
const reviewedBuildToolAdvisories = {
  "decode-uri-component:1243857": {
    "packages": {
      "node_modules/decode-uri-component": {
        "version": "0.5.0",
        "integrity": "sha512-1BiQVoK8C9gUbQU6NzAtO/tkz2qOFpEObMWpcFvhx4fYnj4Oc5yzaJN/LD36ihkVUdXyh5ZekzX+yM+ty/SrPg=="
      },
      "node_modules/query-string": {
        "version": "7.1.3",
        "integrity": "sha512-hh2WYhq4fi8+b+/2Kg9CEge4fDPvHS534aOOvOZeQ3+Vf2mCFsaFBYj0i+iXcAq6I9Vzp5fjMFBlONvayDC1qg=="
      },
      "node_modules/expo-router": {
        "version": "57.0.31",
        "integrity": "sha512-a1JskzAVbIFi9POmayde7U7TkvQHiK5NR2vqTeu4PbU+6oNg9dnsBRmP1kNimDjJJCj6VrGlKPhXASICeFOyYA=="
      }
    },
    "declarations": {
      "decode-uri-component": {
        "node_modules/query-string": {
          "dependencies": "^0.2.2"
        }
      },
      "query-string": {
        "node_modules/expo-router": {
          "dependencies": "^7.1.3"
        }
      }
    }
  },
  "minimatch:1244623": {
    "packages": {
      "node_modules/@expo/fingerprint": {
        "version": "0.20.16",
        "integrity": "sha512-tkucXfg9UoYu6D9evLR3QkC1GYtDqWF5HPudwST6Yz4m/Br7LomCG6MRNpzGJJn8RtDXdkPsk9dXyVIJR8PlWA=="
      },
      "node_modules/glob": {
        "version": "14.0.6",
        "integrity": "sha512-OwXjVP2svY5EyLY75Vek96C8qK43gqrt4xsZ+qSILdnaEiJPXkd62mcfUSNx/TQErQRdu5uM5kF67sfONragKw=="
      },
      "node_modules/glob/node_modules/minimatch": {
        "version": "11.0.8",
        "integrity": "sha512-nFQuYSTVrGvysVBps5Ih+0BdnYFN/Cj3C816r6+p7yK+FHrVLGE4O4N9AFwykrlNlvM2HYt+Rad1Uiro6h88Ig=="
      },
      "node_modules/minimatch": {
        "version": "10.2.6",
        "integrity": "sha512-vpLQEs+VLCr1nU0BXS07maYoFwlDAH0gngQuuttxIwutDFEMHq2blX+8vpgxDdK3J1PwjCJiep77OitTZ4Ll1A=="
      }
    },
    "declarations": {
      "minimatch": {
        "node_modules/@expo/fingerprint": {
          "dependencies": "^10.2.6"
        },
        "node_modules/glob": {
          "dependencies": "^11.0.5"
        }
      }
    }
  }
};

function hasReviewedBuildToolPath(key, lockfile, now) {
  const reviewed = reviewedBuildToolAdvisories[key];
  const packages = lockfile?.packages;
  if (!reviewed || !packages || !Number.isFinite(now)
    || now < BUILD_TOOL_REVIEW_STARTED || now >= BUILD_TOOL_REVIEW_EXPIRES) return false;

  for (const [packagePath, expected] of Object.entries(reviewed.packages)) {
    const metadata = packages[packagePath];
    if (metadata?.version !== expected.version || metadata?.integrity !== expected.integrity) return false;
    // Reject every unreviewed nested copy, including byte-identical copies.
    // Patched glob and minimatch copies are pinned individually above.
    const suffix = `/node_modules/${packagePath.slice('node_modules/'.length)}`;
    if (Object.keys(packages).some((candidate) => candidate.endsWith(suffix)
      && !Object.hasOwn(reviewed.packages, candidate))) return false;
  }

  const kinds = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
  for (const [dependency, expectedParents] of Object.entries(reviewed.declarations)) {
    const actualParents = Object.entries(packages).filter(([, metadata]) =>
      kinds.some((kind) => typeof metadata?.[kind]?.[dependency] === 'string'));
    if (actualParents.length !== Object.keys(expectedParents).length) return false;
    for (const [parentPath, metadata] of actualParents) {
      const expectedEdges = expectedParents[parentPath];
      if (!expectedEdges) return false;
      for (const kind of kinds) {
        if (metadata?.[kind]?.[dependency] !== expectedEdges[kind]) return false;
      }
    }
  }
  return true;
}

export const reviewedAdvisoryCount = acceptedSimpleAdvisories.size + STREAM_JSON_ADVISORIES.size + Object.keys(reviewedBuildToolAdvisories).length;

export function isAcceptedAdvisory({ packageName, source, lockfile, now = Date.now() }) {
  const key = `${packageName}:${source}`;
  if (acceptedSimpleAdvisories.has(key)) return true;
  if (Object.hasOwn(reviewedBuildToolAdvisories, key)) return hasReviewedBuildToolPath(key, lockfile, now);
  if (!STREAM_JSON_ADVISORIES.has(key)) return false;

  // Clerk bundles unused Solana wallet support in the native SDK. Håfa does
  // not expose that path, and its JSON filter receives no app or user input.
  return hasReviewedStreamJsonPath(lockfile, now);
}
