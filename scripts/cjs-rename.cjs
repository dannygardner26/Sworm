// Rename all .js in app-dist/ to .cjs and fix require paths
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'app-dist');
const repoRoot = path.join(__dirname, '..');

// Clean: copy fresh app-dist/app/*.js over stale app-dist/*.js before rename
const appSubdir = path.join(dir, 'app');
if (fs.existsSync(appSubdir)) {
  for (const entry of fs.readdirSync(appSubdir)) {
    if (entry.endsWith('.js') || entry.endsWith('.js.map')) {
      const src = path.join(appSubdir, entry);
      const dst = path.join(dir, entry);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
  }
}

function walkFiles(startDir, predicate, results = []) {
  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    const fullPath = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, results);
      continue;
    }
    if (predicate(entry.name, fullPath)) results.push(fullPath);
  }
  return results;
}

const jsFiles = walkFiles(dir, (name) => name.endsWith('.js'));
for (const filePath of jsFiles) {
  fs.renameSync(filePath, filePath.replace(/\.js$/, '.cjs'));
}

const cjsFiles = walkFiles(dir, (name) => name.endsWith('.cjs'));
for (const filePath of cjsFiles) {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/require\((['"])(\.{1,2}\/[^'"]+?)(?<!\.cjs|\.js|\.json|\.node)\1\)/g, (match, quote, mod) => {
    if (mod.endsWith('.cjs') || mod.endsWith('.js') || mod.endsWith('.json') || mod.endsWith('.node')) return match;
    const resolved = path.resolve(path.dirname(filePath), mod + '.cjs');
    const resolvedFromRoot = path.resolve(repoRoot, mod + '.cjs');
    if (fs.existsSync(resolved) || fs.existsSync(resolvedFromRoot)) {
      return `require(${quote}${mod}.cjs${quote})`;
    }
    return match;
  });
  fs.writeFileSync(filePath, content);
}

const icoSrc = path.join(__dirname, '..', 'app', 'sworm-icon.ico');
const icoDst = path.join(dir, 'sworm-icon.ico');
if (fs.existsSync(icoSrc) && !fs.existsSync(icoDst)) {
  fs.copyFileSync(icoSrc, icoDst);
}

console.log(`Renamed ${jsFiles.length} files, patched ${cjsFiles.length} files`);
