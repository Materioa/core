import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC_TERRACOTTA = path.join(ROOT, 'src-tauri/icons/brick-orange.png');
const DEFAULT_SRC = path.join(ROOT, 'static/assets/img/app.png');

async function run() {
	if (!fs.existsSync(SRC_TERRACOTTA)) {
		console.error('Source icon not found:', SRC_TERRACOTTA);
		process.exit(1);
	}

	const terracottaBuf = fs.readFileSync(SRC_TERRACOTTA);
	const defaultBuf = fs.existsSync(DEFAULT_SRC)
		? fs.readFileSync(DEFAULT_SRC)
		: fs.readFileSync(path.join(ROOT, 'static/assets/img/icon.png'));

	// 1. Static Web/Preview Assets
	const previewDir = path.join(ROOT, 'static/assets/app-icons');
	if (!fs.existsSync(previewDir)) {
		fs.mkdirSync(previewDir, { recursive: true });
	}

	await sharp(defaultBuf)
		.resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toFile(path.join(previewDir, 'default.png'));
	console.log('✓ static/assets/app-icons/default.png');

	await sharp(terracottaBuf)
		.resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toFile(path.join(previewDir, 'terracotta.png'));
	console.log('✓ static/assets/app-icons/terracotta.png');

	// 2. Tauri Icon
	const tauriIconPath = path.join(ROOT, 'src-tauri/icons/terracotta.png');
	await sharp(terracottaBuf)
		.resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.png()
		.toFile(tauriIconPath);
	console.log('✓ src-tauri/icons/terracotta.png');

	// 3. Android Mipmap densities
	const androidResDir = path.join(ROOT, 'android/app/src/main/res');
	const densities = {
		'mipmap-mdpi': { icon: 48, fg: 108 },
		'mipmap-hdpi': { icon: 72, fg: 162 },
		'mipmap-xhdpi': { icon: 96, fg: 216 },
		'mipmap-xxhdpi': { icon: 144, fg: 324 },
		'mipmap-xxxhdpi': { icon: 192, fg: 432 }
	};

	if (fs.existsSync(androidResDir)) {
		for (const [folder, dims] of Object.entries(densities)) {
			const targetDir = path.join(androidResDir, folder);
			if (!fs.existsSync(targetDir)) {
				fs.mkdirSync(targetDir, { recursive: true });
			}

			// Standard launcher icon
			await sharp(terracottaBuf)
				.resize(dims.icon, dims.icon, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
				.png()
				.toFile(path.join(targetDir, 'ic_launcher_terracotta.png'));

			// Round launcher icon
			await sharp(terracottaBuf)
				.resize(dims.icon, dims.icon, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
				.png()
				.toFile(path.join(targetDir, 'ic_launcher_terracotta_round.png'));

			// Foreground adaptive icon
			const innerIconSize = Math.round(dims.fg * 0.65);
			const innerIcon = await sharp(terracottaBuf)
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
				.toFile(path.join(targetDir, 'ic_launcher_terracotta_foreground.png'));

			console.log(`✓ Android ${folder}: ic_launcher_terracotta.png`);
		}

		// Adaptive XML in mipmap-anydpi-v26
		const anydpiDir = path.join(androidResDir, 'mipmap-anydpi-v26');
		if (!fs.existsSync(anydpiDir)) {
			fs.mkdirSync(anydpiDir, { recursive: true });
		}

		const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_terracotta_foreground"/>
</adaptive-icon>
`;
		fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_terracotta.xml'), xmlContent, 'utf8');
		fs.writeFileSync(path.join(anydpiDir, 'ic_launcher_terracotta_round.xml'), xmlContent, 'utf8');
		console.log('✓ Android mipmap-anydpi-v26 XMLs created');

		// Clean up the invalid file in res root if present
		const invalidResFile = path.join(androidResDir, 'brick-orange.png');
		if (fs.existsSync(invalidResFile)) {
			fs.unlinkSync(invalidResFile);
			console.log('✓ Removed invalid root file android/app/src/main/res/brick-orange.png');
		}
	}

	console.log('Done generating all terracotta icon assets!');
}

run().catch(console.error);
