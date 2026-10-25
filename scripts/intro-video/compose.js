// Intro video, step 2 of 2: turns the recording made by record.js into the video. compose.html draws each
// frame (the recorded window on a backdrop, camera moves, the pointer, captions, title and closing cards);
// this script steps it through time at 30 frames a second and pipes the pictures to ffmpeg.
// Then the README's GIF is made from the video (ffmpeg's two-pass palette, 1000px wide, 10 frames a second, 128
// colors and no dithering: about 5 MB; dithering costs a third more and the frames don't need it).
// Usage: electron scripts/intro-video/compose.js [zh-CN]          (writes dist/intro-video/<lang>/ccui-intro.mp4 and demo.gif)
//        electron scripts/intro-video/compose.js [zh-CN] 2 31.5   (stills at those seconds instead, as still-*.png)
// Needs ffmpeg on the PATH (or its location in the FFMPEG environment variable).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

const LANG = process.argv.includes('zh-CN') ? 'zh-CN' : 'en';
const OUT = path.join(__dirname, '..', '..', 'dist', 'intro-video', LANG);
const { TEXT } = require('./story');
const GIF = { width: 1000, fps: 10, colors: 128 };
const FPS = 30;
const SIZE = { width: 1920, height: 1080 };
const stills = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));

app.whenReady().then(async () => {
  let failed = false;
  try {
    const timeline = JSON.parse(fs.readFileSync(path.join(OUT, 'timeline.json'), 'utf8'));
    const win = new BrowserWindow({
      ...SIZE, show: false, frame: false, useContentSize: true,
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });
    const wc = win.webContents;
    wc.on('console-message', (ev) => { if (ev.level === 'error') console.log('[page]', ev.message); });
    await win.loadFile(path.join(__dirname, 'compose.html'));
    wc.setFrameRate(60);
    const { duration } = await wc.executeJavaScript(`setup(${JSON.stringify(timeline)}, ${JSON.stringify(pathToFileURL(path.join(OUT, 'raw')).href)}, ${JSON.stringify({ lang: LANG, ...TEXT[LANG].cards })})`);
    const picture = async (ms) => {
      await wc.executeJavaScript(`renderFrame(${ms})`);
      const image = await wc.capturePage();
      const { width, height } = image.getSize();
      if (width !== SIZE.width || height !== SIZE.height) throw new Error(`The page was captured at ${width}×${height}, not ${SIZE.width}×${SIZE.height}.`);
      return image;
    };

    if (stills.length) {
      for (const s of stills) {
        fs.writeFileSync(path.join(OUT, `still-${s}.png`), (await picture(s * 1000)).toPNG());
        console.log('saved still', s);
      }
    } else {
      const file = path.join(OUT, 'ccui-intro.mp4');
      const ffmpeg = spawn(process.env.FFMPEG || 'ffmpeg', [
        '-y', '-v', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${SIZE.width}x${SIZE.height}`, '-r', String(FPS), '-i', '-',
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-movflags', '+faststart', file,
      ], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((resolve, reject) => {
        ffmpeg.on('error', (err) => reject(new Error(`ffmpeg could not start: ${err.message}`)));
        ffmpeg.on('close', (code) => (code ? reject(new Error(`ffmpeg exited with code ${code}`)) : resolve()));
      });
      // If ffmpeg stops early, the loop below must stop too instead of waiting on its closed input.
      let stopped = null;
      done.catch((err) => { stopped = err; });
      ffmpeg.stdin.on('error', () => {});
      const total = Math.ceil((duration / 1000) * FPS);
      for (let i = 0; i < total; i++) {
        const bitmap = (await picture((i * 1000) / FPS)).toBitmap();
        if (stopped) throw stopped;
        if (!ffmpeg.stdin.write(bitmap)) await Promise.race([new Promise((r) => ffmpeg.stdin.once('drain', r)), done.catch(() => {})]);
        if (i % 300 === 0) console.log(`frame ${i} of ${total}`);
      }
      ffmpeg.stdin.end();
      await done;
      console.log(`wrote ${file} (${(duration / 1000).toFixed(1)} s)`);
      const gif = path.join(OUT, 'demo.gif');
      await new Promise((resolve, reject) => {
        const p = spawn(process.env.FFMPEG || 'ffmpeg', [
          '-y', '-v', 'error', '-i', file,
          '-filter_complex', `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${GIF.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
          gif,
        ], { stdio: ['ignore', 'inherit', 'inherit'] });
        p.on('error', reject);
        p.on('close', (code) => (code ? reject(new Error(`ffmpeg (GIF) exited with code ${code}`)) : resolve()));
      });
      console.log(`wrote ${gif} (${(fs.statSync(gif).size / 1e6).toFixed(1)} MB)`);
    }
  } catch (err) {
    console.error('failed:', err);
    failed = true;
  }
  app.exit(failed ? 1 : 0);
});
