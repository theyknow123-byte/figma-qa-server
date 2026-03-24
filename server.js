const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3845;

// 환경별 Chrome 경로 자동 감지
function getChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const fs = require('fs');
  const paths = [
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of paths) { if (fs.existsSync(p)) return p; }
  return undefined; // puppeteer 기본 chromium
}

function cssColorToHex(cssColor) {
  const m = cssColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return cssColor.toLowerCase().replace(/\s/g, '');
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

function compareColor(figmaHex, cssColor) {
  if (!figmaHex || !cssColor) return null;
  if (cssColor === 'rgba(0, 0, 0, 0)' || cssColor === 'transparent') return null;
  const demoHex = cssColorToHex(cssColor);
  if (figmaHex.toLowerCase() === demoHex.toLowerCase()) return null;
  return { figmaValue: figmaHex, demoValue: demoHex };
}

function compareNumber(figmaVal, demoVal, tolerance = 1) {
  if (figmaVal === null || figmaVal === undefined) return null;
  if (demoVal === null || demoVal === undefined) return null;
  const diff = Math.abs(figmaVal - demoVal);
  if (diff <= tolerance) return null;
  return { figmaValue: `${figmaVal}px`, demoValue: `${demoVal}px`, diff: `${diff.toFixed(0)}px 차이` };
}

app.post('/analyze', async (req, res) => {
  const { demoUrl, figmaSpecs, frameWidth, frameHeight } = req.body;
  if (!demoUrl || !figmaSpecs) {
    return res.status(400).json({ error: 'demoUrl, figmaSpecs 필요' });
  }

  let browser;
  try {
    console.log('🔍 데모 접속 중:', demoUrl);
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: getChromePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setViewport({
      width: frameWidth || 390,
      height: frameHeight || 844,
      deviceScaleFactor: 2
    });
    await page.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    );
    await page.goto(demoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const issues = [];
    const textSpecs = figmaSpecs.filter(
      s => s.type === 'TEXT' && s.text && s.text.trim().length >= 2
    );

    for (const spec of textSpecs) {
      const demoStyles = await page.evaluate((searchText) => {
        function findByText(text) {
          const trimmed = text.trim();
          const all = document.querySelectorAll('*');
          for (const el of all) {
            const direct = [...el.childNodes]
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim())
              .join('');
            if (direct === trimmed) return el;
          }
          return null;
        }
        const el = findByText(searchText);
        if (!el) return null;
        const s = window.getComputedStyle(el);
        return {
          fontSize: parseFloat(s.fontSize),
          fontWeight: parseFloat(s.fontWeight),
          color: s.color,
          lineHeight: s.lineHeight === 'normal' ? null : parseFloat(s.lineHeight),
          letterSpacing: parseFloat(s.letterSpacing) || 0,
        };
      }, spec.text);

      if (!demoStyles) continue;

      const checks = [
        {
          label: '폰트 크기',
          property: 'font-size',
          diff: compareNumber(spec.styles?.fontSize, demoStyles.fontSize),
          severity: 'high'
        },
        {
          label: '폰트 굵기',
          property: 'font-weight',
          diff: compareNumber(spec.styles?.fontWeight, demoStyles.fontWeight, 50),
          severity: 'medium'
        },
        {
          label: '텍스트 색상',
          property: 'color',
          diff: compareColor(spec.styles?.color, demoStyles.color),
          severity: 'high'
        },
        {
          label: '줄간격',
          property: 'line-height',
          diff: compareNumber(spec.styles?.lineHeight, demoStyles.lineHeight),
          severity: 'medium'
        },
      ];

      for (const check of checks) {
        if (!check.diff) continue;
        const d = check.diff;
        issues.push({
          title: `${spec.name}: ${check.label}`,
          description: `Figma: ${d.figmaValue} → 데모: ${d.demoValue}${d.diff ? ` (${d.diff})` : ''}`,
          severity: check.severity,
          nodeX: spec.x,
          nodeY: spec.y,
          nodeWidth: spec.width,
          nodeHeight: spec.height,
          nodeId: spec.id,
        });
      }
    }

    await browser.close();
    browser = null;

    console.log(`✅ ${issues.length}개 이슈 발견`);
    res.json({ issues });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('❌ 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok', version: '2.0.0' }));

app.listen(PORT, () => {
  console.log(`\n🚀 Figma QA 서버 실행 중: http://localhost:${PORT}`);
  console.log('📌 Figma 플러그인에서 이 주소로 연결하세요\n');
});
