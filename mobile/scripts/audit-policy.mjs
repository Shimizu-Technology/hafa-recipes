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
export const streamJsonReviewExpiresAt = '2026-11-17T00:00:00Z';
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

// Temporary exceptions for build-tool and unused wallet advisories. These are
// not runtime vulnerability fixes; see ../docs/dependency-audit-review.md.
// Any changed version, integrity, declaring parent/range, duplicate install,
// or expired review fails closed and requires a fresh reachability assessment.
const BUILD_TOOL_REVIEW_STARTED = Date.parse('2026-10-24T00:00:00Z');
export const buildToolReviewExpiresAt = '2026-11-17T00:00:00Z';
const BUILD_TOOL_REVIEW_EXPIRES = Date.parse(buildToolReviewExpiresAt);
const reviewedBuildToolAdvisories = {
  // Zod is confined to CLI devtools and the unused Clerk wallet chain.
  "zod:1243066": {
    "packages": {
      "node_modules/@base-org/account": {
        "version": "2.0.1",
        "integrity": "sha512-tySVNx+vd6XEynZL0uvB10uKiwnAfThr8AbKTwILVG86mPbLAhEOInQIk+uDnvpTvfdUhC1Bi5T/46JvFoLZQQ=="
      },
      "node_modules/@clerk/clerk-js": {
        "version": "6.29.3",
        "integrity": "sha512-CfamNIf04jhwAMr4+tMI/ZOXj04Tep725cTrnz/Ve6PtjAFzS2XkYlOPjiBA9yfk8gYMbuI4zZeAklbs84UC8g=="
      },
      "node_modules/@clerk/expo": {
        "version": "4.5.2",
        "integrity": "sha512-sdvcXJ9dPIaZaGTM8clxyQCwpEYuL4mSBnMoXLoOKzHPKSxeW6Y4FQqQbiT/Rr954cUKAjeFYD4oPSboP9yWog=="
      },
      "node_modules/@expo/cli": {
        "version": "57.0.32",
        "integrity": "sha512-3p1qL/pvWblGNwDE1bt2wh/NUiGpSer61s5GKKFfpEpBkZTYnqve0pdK1UvEFzJGT6PW9vX2RofQQ2LP6MgvDQ=="
      },
      "node_modules/abitype": {
        "version": "1.3.0",
        "integrity": "sha512-fk6Te+bojIFrMvMZrnOO+SxCB+RUksTGOzq/60ZRvs1L+BVzvi2bqt9L3W/17ZLdZsyM1FuYf65P5nlmoiH1Bg=="
      },
      "node_modules/expo": {
        "version": "57.0.31",
        "integrity": "sha512-+9AJvHZMLIY/Tv6r5Tpu84vWfI75FBTnineYqjjlHAU138IPg2gYQKn9FQFetCB9YScwyc7STk7WGHSCHAdTiQ=="
      },
      "node_modules/ox": {
        "version": "0.6.9",
        "integrity": "sha512-wi5ShvzE4eOcTwQVsIPdFr+8ycyX+5le/96iAJutaZAvCes1J0+RvpEPg5QDPDiaR0XQQAvZVl7AwqQcINuUug=="
      },
      "node_modules/viem": {
        "version": "2.55.19",
        "integrity": "sha512-4QPIX0eYPLsOBk53NKswVMkQoxuP7GlOBnB4wM6dkDokREO4QENNc3bmyPKK1PBTViXh0TPJCHLjIuU20Qi3fg=="
      },
      "node_modules/viem/node_modules/abitype": {
        "version": "1.2.3",
        "integrity": "sha512-Ofer5QUnuUdTFsBRwARMoWKOH1ND5ehwYhJ3OJ/BQO+StkwQjHw0XyVh4vDttzHB7QOFhPHa/o413PJ82gU/Tg=="
      },
      "node_modules/viem/node_modules/ox": {
        "version": "0.14.34",
        "integrity": "sha512-12seOIk7dv8eAoGQhcWaeKZxNz304IVcDvb9U5Y7JZAEVe21Nm1YMxLjhWah+su5BD4Omx4Zz0z5x3ij9M4GYQ=="
      },
      "node_modules/zod": {
        "version": "3.25.76",
        "integrity": "sha512-gzUt/qt81nXsFGKIFcC3YnfEAx5NkunCfnDlvuBSSFS02bcXu4Lmea0AFIUwbLWxWPx3d9p8S5QoaujKcNQxcQ=="
      },
      "node_modules/@coinbase/wallet-sdk": {
        "version": "4.3.7",
        "integrity": "sha512-z6e5XDw6EF06RqkeyEa+qD0dZ2ZbLci99vx3zwDY//XO8X7166tqKJrR2XlQnzVmtcUuJtCd5fCvr9Cu6zzX7w=="
      }
    },
    "declarations": {
      "zod": {
        "node_modules/@expo/cli": {
          "dependencies": "^3.25.76"
        },
        "node_modules/abitype": {
          "peerDependencies": "^3.22.0 || ^4.0.0"
        },
        "node_modules/viem/node_modules/abitype": {
          "peerDependencies": "^3.22.0 || ^4.0.0"
        }
      },
      "abitype": {
        "node_modules/ox": {
          "dependencies": "^1.0.6"
        },
        "node_modules/viem": {
          "dependencies": "1.2.3"
        },
        "node_modules/viem/node_modules/ox": {
          "dependencies": "^1.2.3"
        }
      },
      "ox": {
        "node_modules/@base-org/account": {
          "dependencies": "0.6.9"
        },
        "node_modules/viem": {
          "dependencies": "0.14.34"
        }
      },
      "viem": {
        "node_modules/@base-org/account": {
          "dependencies": "^2.31.7"
        },
        "node_modules/@coinbase/wallet-sdk": {
          "dependencies": "^2.27.2"
        }
      },
      "@base-org/account": {
        "node_modules/@clerk/clerk-js": {
          "dependencies": "2.0.1"
        }
      },
      "@clerk/clerk-js": {
        "node_modules/@clerk/expo": {
          "dependencies": "^6.29.3"
        }
      },
      "@clerk/expo": {
        "": {
          "dependencies": "^4.5.2"
        }
      },
      "@expo/cli": {
        "node_modules/expo": {
          "dependencies": "^57.0.32"
        }
      },
      "expo": {
        "": {
          "dependencies": "~57.0.31"
        },
        "modules/hafa-widget-bridge": {
          "peerDependencies": "*"
        },
        "node_modules/@clerk/expo": {
          "peerDependencies": ">=54 <58"
        },
        "node_modules/@expo/cli": {
          "peerDependencies": "*"
        },
        "node_modules/@expo/dom-webview": {
          "peerDependencies": "*"
        },
        "node_modules/@expo/log-box": {
          "peerDependencies": "*"
        },
        "node_modules/@expo/metro-config": {
          "peerDependencies": "*"
        },
        "node_modules/@expo/metro-runtime": {
          "peerDependencies": "*"
        },
        "node_modules/@expo/router-server": {
          "peerDependencies": "*"
        },
        "node_modules/@expo/ui": {
          "peerDependencies": "*"
        },
        "node_modules/@sentry/react-native": {
          "peerDependencies": ">=49.0.0"
        },
        "node_modules/babel-preset-expo": {
          "peerDependencies": "*"
        },
        "node_modules/expo-apple-authentication": {
          "peerDependencies": "*"
        },
        "node_modules/expo-application": {
          "peerDependencies": "*"
        },
        "node_modules/expo-asset": {
          "peerDependencies": "*"
        },
        "node_modules/expo-audio": {
          "peerDependencies": "*"
        },
        "node_modules/expo-build-properties": {
          "peerDependencies": "*"
        },
        "node_modules/expo-clipboard": {
          "peerDependencies": "*"
        },
        "node_modules/expo-constants": {
          "peerDependencies": "*"
        },
        "node_modules/expo-crypto": {
          "peerDependencies": "*"
        },
        "node_modules/expo-dev-client": {
          "peerDependencies": "*"
        },
        "node_modules/expo-dev-launcher": {
          "peerDependencies": "*"
        },
        "node_modules/expo-dev-menu": {
          "peerDependencies": "*"
        },
        "node_modules/expo-dev-menu-interface": {
          "peerDependencies": "*"
        },
        "node_modules/expo-file-system": {
          "peerDependencies": "*"
        },
        "node_modules/expo-font": {
          "peerDependencies": "*"
        },
        "node_modules/expo-glass-effect": {
          "peerDependencies": "*"
        },
        "node_modules/expo-haptics": {
          "peerDependencies": "*"
        },
        "node_modules/expo-image": {
          "peerDependencies": "*"
        },
        "node_modules/expo-image-loader": {
          "peerDependencies": "*"
        },
        "node_modules/expo-image-picker": {
          "peerDependencies": "*"
        },
        "node_modules/expo-keep-awake": {
          "peerDependencies": "*"
        },
        "node_modules/expo-linear-gradient": {
          "peerDependencies": "*"
        },
        "node_modules/expo-manifests": {
          "peerDependencies": "*"
        },
        "node_modules/expo-notifications": {
          "peerDependencies": "*"
        },
        "node_modules/expo-router": {
          "peerDependencies": "*"
        },
        "node_modules/expo-secure-store": {
          "peerDependencies": "*"
        },
        "node_modules/expo-share-intent": {
          "peerDependencies": "^57"
        },
        "node_modules/expo-speech-recognition": {
          "peerDependencies": "*"
        },
        "node_modules/expo-splash-screen": {
          "peerDependencies": "*"
        },
        "node_modules/expo-status-bar": {
          "peerDependencies": "*"
        },
        "node_modules/expo-symbols": {
          "peerDependencies": "*"
        },
        "node_modules/expo-system-ui": {
          "peerDependencies": "*"
        },
        "node_modules/expo-updates": {
          "peerDependencies": "*"
        },
        "node_modules/expo-updates-interface": {
          "peerDependencies": "*"
        },
        "node_modules/expo-web-browser": {
          "peerDependencies": "*"
        }
      },
      "@coinbase/wallet-sdk": {
        "node_modules/@clerk/clerk-js": {
          "dependencies": "4.3.7"
        }
      }
    }
  },
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
        "version": "57.0.4",
        "integrity": "sha512-gLABIbU3SlxRVVCe56ZfYFbxjhdpAKomQYr6LIeDYf7rca8Pfvzv8FS39hH0+IcdpEHly2Jy0X2nd4/obd8Kig=="
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
        "version": "57.0.32",
        "integrity": "sha512-3p1qL/pvWblGNwDE1bt2wh/NUiGpSer61s5GKKFfpEpBkZTYnqve0pdK1UvEFzJGT6PW9vX2RofQQ2LP6MgvDQ=="
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
    // Reject every unreviewed nested copy, including byte-identical copies.
    // Zod's wallet chain explicitly pins both installed abitype/ox copies.
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
