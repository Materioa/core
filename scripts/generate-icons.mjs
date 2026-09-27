import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_PNG = path.join(ROOT, 'static/assets/img/app.png');
const SVG_PATH = path.join(ROOT, 'static/assets/img/favicon.svg');
const FALLBACK_PNG = path.join(ROOT, 'static/assets/img/favicon.png');

async function getSourceBuffer() {
	if (fs.existsSync(APP_PNG)) {
		console.log('Using static/assets/img/app.png as source icon');
		return fs.readFileSync(APP_PNG);
	}
	if (fs.existsSync(SVG_PATH)) {
		return fs.readFileSync(SVG_PATH);
	}
	return fs.readFileSync(FALLBACK_PNG);
}

function createIco(pngBuffers, sizes) {
	const count = pngBuffers.length;
	const headerSize = 6 + count * 16;
	let currentOffset = headerSize;

	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0); // Reserved
	header.writeUInt16LE(1, 2); // 1 = ICO
	header.writeUInt16LE(count, 4);

	const entries = [];
	for (let i = 0; i < count; i++) {
		const buf = pngBuffers[i];
		const size = sizes[i];
		const entry = Buffer.alloc(16);
		entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width
		entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height
		entry.writeUInt8(0, 2); // Color count
		entry.writeUInt8(0, 3); // Reserved
		entry.writeUInt16LE(1, 4); // Color planes
		entry.writeUInt16LE(32, 6); // Bits per pixel
		entry.writeUInt32LE(buf.length, 8); // Image size in bytes
		entry.writeUInt32LE(currentOffset, 12); // Offset
		entries.push(entry);
		currentOffset += buf.length;
	}

	return Buffer.concat([header, ...entries, ...pngBuffers]);
}

async function generate() {
	console.log('Generating app icons from favicon...');
	const src = await getSourceBuffer();

	// 1. Tauri Desktop Icons
	const tauriIconsDir = path.join(ROOT, 'src-tauri/icons');
	if (!fs.existsSync(tauriIconsDir)) {
		fs.mkdirSync(tauriIconsDir, { recursive: true });
	}

	const tauriSizes = {
		'32x32.png': 32,
		'128x128.png': 128,
		'128x128@2x.png': 256,
		'icon.png': 512,
		'Square30x30Logo.png': 30,
		'Square44x44Logo.png': 44,
		'Square71x71Logo.png': 71,
		'Square89x89Logo.png': 89,
		'Square107x107Logo.png': 107,
		'Square142x142Logo.png': 142,
		'Square150x150Logo.png': 150,
		'Square284x284Logo.png': 284,
		'Square310x310Logo.png': 310,
		'StoreLogo.png': 50
	};

	for (const [filename, size] of Object.entries(tauriSizes)) {
		const outPath = path.join(tauriIconsDir, filename);
		await sharp(src, { density: 300 })
			.resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.png()
			.toFile(outPath);
		console.log(`  ✓ Tauri: ${filename} (${size}x${size})`);
	}

	// Create multi-size icon.ico for Windows
	const icoSizes = [16, 24, 32, 48, 64, 128, 256];
	const icoBuffers = [];
	for (const s of icoSizes) {
		const buf = await sharp(src, { density: 300 })
			.resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.png()
			.toBuffer();
		icoBuffers.push(buf);
	}
	const icoBuffer = createIco(icoBuffers, icoSizes);
	fs.writeFileSync(path.join(tauriIconsDir, 'icon.ico'), icoBuffer);
	console.log(`  ✓ Tauri: icon.ico (${icoSizes.join(', ')})`);

	// 2. Android App Icons
	const androidResDir = path.join(ROOT, 'android/app/src/main/res');
	const androidDensities = {
		'mipmap-mdpi': { icon: 48, fg: 108 },
		'mipmap-hdpi': { icon: 72, fg: 162 },
		'mipmap-xhdpi': { icon: 96, fg: 216 },
		'mipmap-xxhdpi': { icon: 144, fg: 324 },
		'mipmap-xxxhdpi': { icon: 192, fg: 432 }
	};

	if (fs.existsSync(androidResDir)) {
		for (const [folder, dims] of Object.entries(androidDensities)) {
			const targetDir = path.join(androidResDir, folder);
			if (!fs.existsSync(targetDir)) {
				fs.mkdirSync(targetDir, { recursive: true });
			}

			// Standard launcher icon
			await sharp(src, { density: 300 })
				.resize(dims.icon, dims.icon, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
				.png()
				.toFile(path.join(targetDir, 'ic_launcher.png'));

			// Round launcher icon
			await sharp(src, { density: 300 })
				.resize(dims.icon, dims.icon, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
				.png()
				.toFile(path.join(targetDir, 'ic_launcher_round.png'));

			// Foreground adaptive icon (icon padded inside canvas)
			const innerIconSize = Math.round(dims.fg * 0.65);
			const innerIcon = await sharp(src, { density: 300 })
				.resize(innerIconSize, innerIconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
				.png()
				.toBuffer();

			await sharp({
				create: {
					width: dims.fg,
					height: dims.fg,
					channels: 4,
					background: { r: 0, g: 0, b: 0, alpha: 0 }
				}
			})
				.composite([{ input: innerIcon, gravity: 'center' }])
				.png()
				.toFile(path.join(targetDir, 'ic_launcher_foreground.png'));

			console.log(`  ✓ Android ${folder}: ${dims.icon}x${dims.icon}, fg ${dims.fg}x${dims.fg}`);
		}
	} else {
		console.warn(`Android res directory not found at: ${androidResDir}`);
	}

	console.log('✅ App icons successfully generated from favicon!');
}

generate().catch(err => {
	console.error('Error generating icons:', err);
	process.exit(1);
});
