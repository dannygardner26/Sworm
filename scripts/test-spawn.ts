/// <reference types="node" />
import { createPlatform } from '../src/platform/index.js';

async function main() {
  const platform = createPlatform();

  console.log('Snapshotting current windows...');
  const before = await platform.windows.findByTitle(/./);
  console.log(`Found ${before.length} existing windows`);
  const beforeSet = new Set(before);

  console.log('Spawning wt.exe...');
  const spawned = await platform.processes.spawn('wt.exe', ['-w', 'new', '--title', 'SwormTest']);
  console.log(`PID: ${spawned.pid}`);

  console.log('Waiting 4s...');
  await new Promise(r => setTimeout(r, 4000));

  console.log('Finding new windows...');
  const after = await platform.windows.findByTitle(/./);
  const newWindows = after.filter(h => !beforeSet.has(h));
  console.log(`New windows: ${newWindows.length}`);

  for (const hwnd of newWindows) {
    const title = await platform.windows.getTitle(hwnd);
    console.log(`  [${hwnd}] "${title}"`);
  }

  if (newWindows.length > 0) {
    const hwnd = newWindows[0];
    console.log(`\nMoving window ${hwnd} to top-left quadrant (0,0 960x582)...`);
    await platform.windows.move(hwnd, { x: 0, y: 0, width: 960, height: 582 });
    console.log('Moved! Waiting 3s so you can see it...');
    await new Promise(r => setTimeout(r, 3000));

    console.log('Closing window...');
    await platform.windows.close(hwnd);
  }

  spawned.kill();
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
