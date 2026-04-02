// Rename all .js in app-dist/ to .cjs and fix require paths
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'app-dist');

// First rename all .js to .cjs
const jsFiles = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  fs.renameSync(path.join(dir, f), path.join(dir, f.replace('.js', '.cjs')));
}

// Then fix require paths in .cjs files to reference .cjs extensions
const cjsFiles = fs.readdirSync(dir).filter(f => f.endsWith('.cjs'));
for (const f of cjsFiles) {
  const fp = path.join(dir, f);
  let content = fs.readFileSync(fp, 'utf-8');
  // Fix require("./something") to require("./something.cjs") for local modules
  content = content.replace(/require\((['"])\.\/([^'"]+?)\1\)/g, (match, quote, mod) => {
    if (mod.endsWith('.cjs') || mod.endsWith('.js') || mod.endsWith('.json') || mod.endsWith('.node')) return match;
    if (fs.existsSync(path.join(dir, mod + '.cjs'))) {
      return `require(${quote}./${mod}.cjs${quote})`;
    }
    return match;
  });
  fs.writeFileSync(fp, content);
}

// Copy icon to app-dist
const icoSrc = path.join(__dirname, '..', 'app', 'sworm-icon.ico');
const icoDst = path.join(dir, 'sworm-icon.ico');
if (fs.existsSync(icoSrc) && !fs.existsSync(icoDst)) {
  fs.copyFileSync(icoSrc, icoDst);
}

console.log(`Renamed ${jsFiles.length} files, patched ${cjsFiles.length} files`);
