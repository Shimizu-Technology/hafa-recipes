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

// Temporary exceptions for two unpatched build-tool advisories. These are
// not runtime vulnerability fixes; see ../docs/dependency-audit-review.md.
// Any changed version, integrity, declaring parent/range, duplicate install,
// or expired review fails closed and requires a fresh reachability assessment.
const BUILD_TOOL_REVIEW_STARTED = Date.parse('2026-10-04T00:00:00Z');
export const buildToolReviewExpiresAt = '2026-11-03T00:00:00Z';
const BUILD_TOOL_REVIEW_EXPIRES = Date.parse(buildToolReviewExpiresAt);
const reviewedBuildToolAdvisories = {
  "braces:1240992": {
    "packages": {
      "node_modules/braces": {
        "version": "3.0.3",
        "integrity": "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA=="
      },
      "node_modules/micromatch": {
        "version": "4.0.8",
        "integrity": "sha512-PXwfBhYu0hBCPw8Dn0E+WDYb7af3dSLVWKi3HGv84IdF4TyFoC0ysxFd0Goxw7nSv4T/PzEJQxsYsEiFCKo2BA=="
      },
      "node_modules/@expo/metro-file-map": {
        "version": "57.0.3",
        "integrity": "sha512-1OXy+uPYY5uc7Tm4VBsd2NRn+3wHhqeqNuEO/Xo4kmYgv8FjYgUAc+bUXON9FpC2ikcLn4EVlGM9ce2exx9Mlg=="
      },
      "node_modules/metro-file-map": {
        "version": "0.84.5",
        "integrity": "sha512-mlm/JL8toSbSc2akpKIGmzvrVRSCgZ5vkbycI34oMLoOnLGuLyC8WTyVJ6P0hZG/usDaGwZSl/s9BCRriqjGJA=="
      },
      "node_modules/find-yarn-workspace-root": {
        "version": "2.0.0",
        "integrity": "sha512-1IMnbjt4KzsQfnhnzNd8wUEgXZ44IzZaZmnLYx7D5FZlaHt2gW20Cri8Q+E/t5tIj4+epTBub+2Zxu/vNILzqQ=="
      }
    },
    "declarations": {
      "braces": {
        "node_modules/micromatch": {
          "dependencies": "^3.0.3"
        }
      },
      "micromatch": {
        "node_modules/@expo/metro-file-map": {
          "dependencies": "^4.0.4"
        },
        "node_modules/metro-file-map": {
          "dependencies": "^4.0.4"
        },
        "node_modules/find-yarn-workspace-root": {
          "dependencies": "^4.0.2"
        }
      }
    }
  },
  "node-forge:1240912": {
    "packages": {
      "node_modules/node-forge": {
        "version": "1.4.0",
        "integrity": "sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ=="
      },
      "node_modules/@expo/cli": {
        "version": "57.0.27",
        "integrity": "sha512-Jauk4chxmpVG5ElrMLTCwjFP20jbYU7PB4l3LYV8j+4e/3HU5jdl7qTQ4eVy1AaDUE9Ia2NCQ5A9kar2V1gaLg=="
      },
      "node_modules/@expo/code-signing-certificates": {
        "version": "0.0.6",
        "integrity": "sha512-iNe0puxwBNEcuua9gmTGzq+SuMDa0iATai1FlFTMHJ/vUmKvN/V//drXoLJkVb5i5H3iE/n/qIJxyoBnXouD0w=="
      }
    },
    "declarations": {
      "node-forge": {
        "node_modules/@expo/cli": {
          "dependencies": "^1.3.3"
        },
        "node_modules/@expo/code-signing-certificates": {
          "dependencies": "^1.3.3"
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
    // A nested duplicate is a new, unreviewed dependency path even when its
    // tarball matches the hoisted package; do not accept it by package name.
    const suffix = `/node_modules/${packagePath.slice('node_modules/'.length)}`;
    if (Object.keys(packages).some((candidate) => candidate.endsWith(suffix))) return false;
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

export const reviewedAdvisoryCount = acceptedSimpleAdvisories.size + 1 + Object.keys(reviewedBuildToolAdvisories).length;

export function isAcceptedAdvisory({ packageName, source, lockfile, now = Date.now() }) {
  const key = `${packageName}:${source}`;
  if (acceptedSimpleAdvisories.has(key)) return true;
  if (Object.hasOwn(reviewedBuildToolAdvisories, key)) return hasReviewedBuildToolPath(key, lockfile, now);
  if (key !== STREAM_JSON_ADVISORY) return false;

  // Clerk bundles unused Solana wallet support in the native SDK. Håfa does
  // not expose that path, and its JSON filter receives no app or user input.
  return hasReviewedStreamJsonPath(lockfile);
}
