#!/usr/bin/env node

/**
 * Enforce Canonical Structure Rule
 * 
 * Prevents creation of new top-level arbitrage/* or hero/* folders
 * outside the canonical roots:
 *   - arbitragebot/
 *   - hero-super-agent/
 * 
 * This script runs as a pre-commit hook or lint check to maintain repo organization.
 */

import fs from 'fs';
import path from 'path';

const CANONICAL_ROOTS = {
    arbitrage: 'arbitragebot/',
    hero: 'hero-super-agent/',
};

const BLOCKED_PATTERNS = [
    /^arbitrage[^/]*\/$/,  // arbitrage*, arbitrage-*, etc at root
    /^hero[^/]*\/$/,        // hero*, hero-*, etc at root
];

function getTopLevelDirs() {
    const appRoot = process.cwd();
    const items = fs.readdirSync(appRoot);

    return items.filter(item => {
        const fullPath = path.join(appRoot, item);
        const stat = fs.statSync(fullPath, { throwIfNoEntry: false });
        return stat?.isDirectory() && !item.startsWith('.');
    });
}

function checkViolations() {
    const dirs = getTopLevelDirs();
    const violations = [];

    for (const dir of dirs) {
        for (const pattern of BLOCKED_PATTERNS) {
            if (pattern.test(dir + '/')) {
                // Exclude canonical roots
                if (!Object.values(CANONICAL_ROOTS).some(canonical => canonical.startsWith(dir))) {
                    violations.push({
                        dir,
                        type: dir.startsWith('arbitrage') ? 'arbitrage' : 'hero',
                        canonical: CANONICAL_ROOTS[dir.split(/[-_]/)[0].toLowerCase()],
                    });
                }
            }
        }
    }

    return violations;
}

function main() {
    const violations = checkViolations();

    if (violations.length === 0) {
        console.log('✅ Canonical structure check passed.');
        process.exit(0);
    }

    console.error('❌ Structure violations detected:\n');

    violations.forEach(v => {
        console.error(`  ${v.dir}/`);
        console.error(`    → Move to canonical root: ${v.canonical}`);
    });

    console.error(`\nCanonical roots:`);
    console.error(`  • arbitrage-related: ${CANONICAL_ROOTS.arbitrage}`);
    console.error(`  • hero-related: ${CANONICAL_ROOTS.hero}`);

    process.exit(1);
}

main();
