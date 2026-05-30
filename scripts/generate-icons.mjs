import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import png2icons from 'png2icons';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sizes = [512, 256, 128, 64, 48, 32, 16];
const inputSvg = path.join(__dirname, '../assets/icon.svg');
const outputDir = path.join(__dirname, '../assets');

async function generateIcons() {
  console.log('Generating icons from SVG...');
  console.log(`Input: ${inputSvg}`);
  console.log(`Output directory: ${outputDir}`);
  console.log('');

  // Generate PNGs at all sizes
  for (const size of sizes) {
    const outputFile = path.join(outputDir, `icon_${size}.png`);
    try {
      await sharp(inputSvg)
        .resize(size, size)
        .png()
        .toFile(outputFile);
      console.log(`✓ Generated: icon_${size}.png`);
    } catch (error) {
      console.error(`✗ Failed to generate icon_${size}.png:`, error.message);
    }
  }

  // Generate ICO (Windows) from 512x512 PNG
  const icoSource = path.join(outputDir, 'icon_512.png');
  if (fs.existsSync(icoSource)) {
    try {
      const input = fs.readFileSync(icoSource);
      const output = png2icons.createICO(input, png2icons.BICUBIC, 0, false, true);
      if (output) {
        const icoPath = path.join(outputDir, 'icon.ico');
        fs.writeFileSync(icoPath, output);
        console.log(`✓ Generated: icon.ico`);
      } else {
        console.error('✗ png2icons.createICO returned null');
      }
    } catch (error) {
      console.error('✗ Failed to generate icon.ico:', error.message);
    }
  }

  // Generate ICNS (macOS) from 512x512 PNG
  if (fs.existsSync(icoSource)) {
    try {
      const input = fs.readFileSync(icoSource);
      const output = png2icons.createICNS(input, png2icons.BICUBIC, 0);
      if (output) {
        const icnsPath = path.join(outputDir, 'icon.icns');
        fs.writeFileSync(icnsPath, output);
        console.log(`✓ Generated: icon.icns`);
      } else {
        console.error('✗ png2icons.createICNS returned null');
      }
    } catch (error) {
      console.error('✗ Failed to generate icon.icns:', error.message);
    }
  }

  // Copy 512x512 as icon.png for Linux
  const linuxSource = path.join(outputDir, 'icon_512.png');
  const linuxTarget = path.join(outputDir, 'icon.png');
  if (fs.existsSync(linuxSource)) {
    fs.copyFileSync(linuxSource, linuxTarget);
    console.log('✓ Generated: icon.png (for Linux)');
  }

  console.log('');
  console.log('Icon generation complete!');
}

generateIcons().catch(console.error);
