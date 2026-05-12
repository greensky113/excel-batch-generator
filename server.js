const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const sharp = require('sharp');
const JSZip = require('jszip');
const path = require('path');
const fs = require('fs');
const http = require('http');
const iconv = require('iconv-lite');

const app = express();
const PORT = 3000;

app.use(express.static(__dirname));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const imageUpload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片格式'), false);
    }
  }
});

const zipUpload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) || file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed') {
      cb(null, true);
    } else {
      cb(new Error('只支持ZIP格式'), false);
    }
  }
});

// 安全配置
const SECURITY_CONFIG = {
  MAX_ZIP_SIZE: 100 * 1024 * 1024, // 100MB
  MAX_FILES_PER_ZIP: 1000,
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB per file
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
};

app.post('/upload/zip-folders', zipUpload.single('zip'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '没有上传文件' });
    }

    if (req.file.size > SECURITY_CONFIG.MAX_ZIP_SIZE) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        success: false, 
        error: `ZIP 文件过大，最大允许 ${SECURITY_CONFIG.MAX_ZIP_SIZE / 1024 / 1024}MB` 
      });
    }

    const zipPath = req.file.path;
    const outputDir = path.join(__dirname, 'uploads');
    
    const zipData = fs.readFileSync(zipPath);
    
    // 关键！不使用JSZip的自动解码，手动处理
    const zip = await JSZip.loadAsync(zipData, {
      decodeFileName: (bytes) => {
        try {
          // 先用GBK解码（Windows压缩的中文ZIP用GBK）
          const decoded = iconv.decode(Buffer.from(bytes), 'gbk');
          console.log('解码文件名:', decoded);
          return decoded;
        } catch (e) {
          // 失败则用UTF-8
          return Buffer.from(bytes).toString('utf8');
        }
      }
    });
    
    const zipFiles = zip.files;
    
    console.log('=== ZIP 文件数量 ===', Object.keys(zipFiles).length);
    
    const entries = [];
    for (const name in zipFiles) {
      entries.push({ name, entry: zipFiles[name] });
    }
    
    console.log('=== ZIP 条目 ===');
    entries.forEach(e => console.log(e.name));
    
    if (entries.length > SECURITY_CONFIG.MAX_FILES_PER_ZIP) {
      fs.unlinkSync(zipPath);
      return res.status(400).json({ 
        success: false, 
        error: `ZIP 文件包含过多文件，最大允许 ${SECURITY_CONFIG.MAX_FILES_PER_ZIP} 个` 
      });
    }
    
    let rootFolder = null;
    const folderPaths = [];
    
    for (const { name, entry } of entries) {
      if (!entry.dir) {
        const parts = name.split('/');
        if (parts.length >= 2) {
          folderPaths.push(parts[0]);
        }
      }
    }
    
    if (folderPaths.length > 0) {
      const uniqueRoots = [...new Set(folderPaths)];
      if (uniqueRoots.length === 1) {
        rootFolder = uniqueRoots[0];
        console.log('检测到根文件夹:', rootFolder);
      }
    }
    
    const folders = [];
    const processedFiles = [];
    
    for (const { name, entry } of entries) {
      if (entry.dir) continue;
      
      if (entry._data && entry._data.uncompressedSize > SECURITY_CONFIG.MAX_FILE_SIZE) {
        console.warn(`跳过过大文件: ${name}`);
        continue;
      }
      
      let relativePath = name.replace(/^[\s\/]+/, '');
      
      if (rootFolder && relativePath.startsWith(rootFolder + '/')) {
        relativePath = relativePath.substring(rootFolder.length + 1);
        console.log('去掉根文件夹后:', relativePath);
      }
      
      if (!relativePath) continue;
      
      if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
        console.warn(`跳过不安全路径: ${name}`);
        continue;
      }
      
      const parts = relativePath.split('/');
      
      if (parts.length >= 2) {
        const folderName = parts[0];
        const fileName = parts[parts.length - 1];
        
        if (!fileName || !isImageFile(fileName)) continue;
        
        if (!validateFilename(folderName) || !validateFilename(fileName)) {
          console.warn(`跳过无效文件名: ${name}`);
          continue;
        }
        
        const folderPath = path.join(outputDir, folderName);
        
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }
        
        const filePath = path.join(folderPath, fileName);
        const content = await entry.async('nodebuffer');
        
        const resolvedPath = path.resolve(filePath);
        const uploadsDir = path.resolve(outputDir);
        if (!resolvedPath.startsWith(uploadsDir)) {
          console.warn(`跳过非法文件路径: ${name}`);
          continue;
        }
        
        fs.writeFileSync(resolvedPath, content);
        
        if (!folders.includes(folderName)) {
          folders.push(folderName);
        }
        
        processedFiles.push({
          folder: folderName,
          file: fileName,
          path: `/uploads/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`
        });
      }
    }
    
    fs.unlinkSync(zipPath);
    
    console.log('=== 最终文件夹 ===');
    folders.forEach(f => console.log(f));
    console.log('处理文件数:', processedFiles.length);
    
    res.json({
      success: true,
      message: `成功导入 ${folders.length} 个文件夹，共 ${processedFiles.length} 张图片`,
      folders: folders,
      files: processedFiles
    });
  } catch (error) {
    console.error('解压失败:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);
}

app.post('/upload/images', imageUpload.array('images', 100), async (req, res) => {
  try {
    const compressedFiles = [];
    
    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let outputFilename = file.filename;
      
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        try {
          const compressedFilename = 'compressed_' + file.filename + '.jpg';
          const outputPath = path.join(__dirname, 'uploads', compressedFilename);
          
          await sharp(file.path)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(outputPath);
          
          outputFilename = compressedFilename;
          fs.unlinkSync(file.path);
        } catch (error) {
          console.warn('图片压缩失败，使用原图:', error.message);
        }
      }
      
      compressedFiles.push({
        originalName: file.originalname,
        filename: outputFilename,
        path: '/uploads/' + outputFilename,
        size: fs.statSync(path.join(__dirname, 'uploads', outputFilename)).size,
        compressed: outputFilename !== file.filename
      });
    }
    
    res.json({ success: true, files: compressedFiles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/upload/single-image', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '没有上传文件' });
    }
    
    const file = req.file;
    const ext = path.extname(file.originalname).toLowerCase();
    let outputFilename = file.filename;
    let compressed = false;
    
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      try {
        const compressedFilename = 'compressed_' + file.filename + '.jpg';
        const outputPath = path.join(__dirname, 'uploads', compressedFilename);
        
        await sharp(file.path)
          .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(outputPath);
        
        outputFilename = compressedFilename;
        compressed = true;
        fs.unlinkSync(file.path);
      } catch (error) {
        console.warn('图片压缩失败，使用原图:', error.message);
      }
    }
    
    res.json({
      success: true,
      file: {
        originalName: file.originalname,
        filename: outputFilename,
        path: '/uploads/' + outputFilename,
        size: fs.statSync(path.join(__dirname, 'uploads', outputFilename)).size,
        compressed: compressed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/compress/images', imageUpload.array('images', 100), async (req, res) => {
  try {
    const results = [];
    const quality = parseInt(req.body.quality) || 80;
    const maxWidth = parseInt(req.body.maxWidth) || 800;
    const maxHeight = parseInt(req.body.maxHeight) || 600;
    
    for (const file of req.files) {
      const ext = path.extname(file.originalname).toLowerCase();
      
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        const compressedFilename = 'compressed_' + file.filename + '.jpg';
        const outputPath = path.join(__dirname, 'uploads', compressedFilename);
        
        const originalSize = fs.statSync(file.path).size;
        
        await sharp(file.path)
          .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: quality })
          .toFile(outputPath);
        
        const compressedSize = fs.statSync(outputPath).size;
        const reduction = Math.round((1 - compressedSize / originalSize) * 100);
        
        fs.unlinkSync(file.path);
        
        results.push({
          originalName: file.originalname,
          filename: compressedFilename,
          path: '/uploads/' + compressedFilename,
          originalSize: originalSize,
          compressedSize: compressedSize,
          reduction: reduction > 0 ? reduction : 0
        });
      } else {
        results.push({
          originalName: file.originalname,
          filename: file.filename,
          path: '/uploads/' + file.filename,
          originalSize: fs.statSync(file.path).size,
          compressedSize: fs.statSync(file.path).size,
          reduction: 0,
          note: '非压缩格式'
        });
      }
    }
    
    res.json({ success: true, files: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 简单的临时文件管理
function ensureTempDir() {
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

// 启动时清理旧的临时文件
function cleanupOldTempFiles() {
  try {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) return;
    
    const now = Date.now();
    const files = fs.readdirSync(tempDir);
    let cleanedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      try {
        const stat = fs.statSync(filePath);
        // 删除超过24小时的旧文件
        if (now - stat.mtimeMs > 24 * 3600000) {
          if (stat.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
          cleanedCount++;
        }
      } catch (e) {
        // 静默忽略错误
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`已清理 ${cleanedCount} 个旧临时文件`);
    }
  } catch (e) {
    console.warn('清理临时文件时出错:', e.message);
  }
}

ensureTempDir();
cleanupOldTempFiles();

app.post('/create/zip', express.raw({ type: 'application/json', limit: '100mb' }), async (req, res) => {
  let zipPath = null;
  try {
    const data = JSON.parse(req.body.toString());
    const zip = new JSZip();
    
    if (data.files && Array.isArray(data.files)) {
      for (const file of data.files) {
        if (file.content) {
          const buffer = Buffer.from(file.content, 'base64');
          const folder = zip.folder(file.folder || '');
          folder.file(file.filename, buffer);
        }
      }
    }
    
    const zipFilename = `批量Excel_${Date.now()}.zip`;
    zipPath = path.join(ensureTempDir(), zipFilename);
    
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    fs.writeFileSync(zipPath, zipBuffer);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    
    res.download(zipPath, zipFilename, (err) => {
      // 下载完成或失败后立即清理
      setTimeout(() => {
        try {
          if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
          }
        } catch (e) {
          console.warn('清理ZIP文件失败:', e);
        }
      }, 30000); // 30秒后清理
    });
  } catch (error) {
    // 出错时清理
    if (zipPath) {
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch (e) {}
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/save/template', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const template = req.body;
    
    if (!template.name || !template.sheets) {
      return res.status(400).json({ success: false, error: '模板数据不完整' });
    }
    
    const templatesDir = path.join(__dirname, 'templates');
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }
    
    const filename = template.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_') + '_' + Date.now() + '.json';
    const filepath = path.join(templatesDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(template, null, 2), 'utf8');
    
    res.json({
      success: true,
      message: '模板保存成功',
      template: {
        filename: filename,
        name: template.name,
        savedAt: new Date().toISOString(),
        size: fs.statSync(filepath).size
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/list/templates', (req, res) => {
  try {
    const templatesDir = path.join(__dirname, 'templates');
    
    if (!fs.existsSync(templatesDir)) {
      return res.json({ success: true, templates: [] });
    }
    
    const files = fs.readdirSync(templatesDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filepath = path.join(templatesDir, file);
        const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        const stats = fs.statSync(filepath);
        
        return {
          filename: file,
          name: content.name || file,
          description: content.description || '',
          sheets: content.sheets ? content.sheets.length : 0,
          savedAt: stats.mtime.toISOString(),
          size: stats.size
        };
      })
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    
    res.json({ success: true, templates: files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/load/template/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, 'templates', filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    
    const template = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    
    // 返回两个字段都支持，兼容前端
    res.json({ success: true, template: template, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/delete/template/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filepath = path.join(__dirname, 'templates', filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, error: '模板不存在' });
    }
    
    fs.unlinkSync(filepath);
    
    res.json({ success: true, message: '模板删除成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/validate/data', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const { template, data } = req.body;
    const errors = [];
    const warnings = [];
    
    if (!template || !template.sheets) {
      errors.push('缺少模板数据');
      return res.json({ valid: false, errors: errors, warnings: warnings });
    }
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      errors.push('缺少数据或数据格式不正确');
      return res.json({ valid: false, errors: errors, warnings: warnings });
    }
    
    const templateFields = new Set();
    const imageFields = [];
    
    template.sheets.forEach(sheet => {
      if (sheet.fields) {
        sheet.fields.forEach(field => {
          if (field.replaceable) {
            templateFields.add(field.name);
          }
          if (field.type === 'image') {
            imageFields.push(field.name);
          }
        });
      }
    });
    
    const dataFields = Object.keys(data[0] || {});
    
    templateFields.forEach(field => {
      if (!dataFields.includes(field)) {
        errors.push(`模板字段 "${field}" 在数据中找不到对应列`);
      }
    });
    
    dataFields.forEach(field => {
      if (!templateFields.has(field)) {
        warnings.push(`数据字段 "${field}" 在模板中未使用`);
      }
    });
    
    const uploadDir = path.join(__dirname, 'uploads');
    const availableFolders = fs.existsSync(uploadDir) 
      ? fs.readdirSync(uploadDir).filter(f => fs.statSync(path.join(uploadDir, f)).isDirectory())
      : [];
    
    const matchedFolders = new Set();
    const unmatchedFolders = new Set();
    
    if (imageFields.length > 0) {
      data.forEach((row, index) => {
        imageFields.forEach(fieldName => {
          const folderName = row[fieldName];
          if (folderName) {
            if (availableFolders.includes(folderName)) {
              matchedFolders.add(folderName);
            } else {
              unmatchedFolders.add(folderName);
              warnings.push(`第 ${index + 1} 行 "${fieldName}" 对应的文件夹 "${folderName}" 不存在`);
            }
          }
        });
      });
    }
    
    data.forEach((row, index) => {
      if (!row || typeof row !== 'object') {
        errors.push(`第 ${index + 1} 行数据格式不正确`);
        return;
      }
      
      template.sheets.forEach(sheet => {
        if (sheet.fields) {
          sheet.fields.forEach(field => {
            if (field.replaceable && field.required) {
              const value = row[field.name];
              if (value === undefined || value === null || value === '') {
                errors.push(`第 ${index + 1} 行 "${field.name}" 字段为必填项`);
              }
            }
            
            if (field.type === 'number' && row[field.name]) {
              if (isNaN(parseFloat(row[field.name]))) {
                errors.push(`第 ${index + 1} 行 "${field.name}" 应为数字`);
              }
            }
            
            if (field.type === 'date' && row[field.name]) {
              const dateValue = new Date(row[field.name]);
              if (isNaN(dateValue.getTime())) {
                warnings.push(`第 ${index + 1} 行 "${field.name}" 日期格式可能不正确`);
              }
            }
          });
        }
      });
    });
    
    res.json({
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      summary: {
        totalRows: data.length,
        totalFields: dataFields.length,
        matchedFields: templateFields.size,
        unmatchedFields: dataFields.filter(f => !templateFields.has(f)).length,
        imageFields: imageFields.length,
        matchedFolders: Array.from(matchedFolders),
        unmatchedFolders: Array.from(unmatchedFolders),
        availableFolders: availableFolders
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/download/all', express.raw({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', limit: '50mb' }), (req, res) => {
  try {
    const tempFile = path.join(__dirname, 'temp-output-' + Date.now() + '.xlsx');
    fs.writeFileSync(tempFile, req.body);
    
    res.download(tempFile, (err) => {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/list/images', (req, res) => {
  try {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      return res.json({ success: true, images: [], folders: [] });
    }
    
    const folders = fs.readdirSync(uploadDir)
      .filter(file => fs.statSync(path.join(uploadDir, file)).isDirectory())
      .map(folderName => {
        const folderPath = path.join(uploadDir, folderName);
        const files = fs.readdirSync(folderPath)
          .filter(file => isImageFile(file))
          .map(file => {
            const filepath = path.join(folderPath, file);
            const stats = fs.statSync(filepath);
            return {
              name: file,
              path: `/uploads/${folderName}/${file}`,
              size: stats.size
            };
          });
        
        return {
          name: folderName,
          path: `/uploads/${folderName}`,
          files: files,
          fileCount: files.length
        };
      });
    
    res.json({ success: true, folders: folders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/list/folders', (req, res) => {
  try {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      return res.json({ success: true, folders: [] });
    }
    
    const folders = fs.readdirSync(uploadDir)
      .filter(file => fs.statSync(path.join(uploadDir, file)).isDirectory())
      .map(folderName => {
        const folderPath = path.join(uploadDir, folderName);
        const files = fs.readdirSync(folderPath)
          .filter(file => isImageFile(file));
        
        return {
          name: folderName,
          path: `/uploads/${folderName}`,
          fileCount: files.length,
          files: files.map(file => ({
            name: file,
            path: `/uploads/${folderName}/${file}`
          }))
        };
      });
    
    res.json({ success: true, folders: folders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 安全的文件名验证函数
function validateFilename(filename) {
  if (!filename) return false;
  // 禁止包含路径分隔符和特殊字符
  const forbiddenChars = /[<>:"/\\|?*\x00-\x1F]/;
  if (forbiddenChars.test(filename)) return false;
  // 禁止路径遍历
  if (filename.includes('..') || filename.startsWith('/') || filename.startsWith('\\')) return false;
  return true;
}

app.delete('/delete/images/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (!validateFilename(filename)) {
      return res.status(400).json({ success: false, error: '无效的文件名' });
    }
    const filePath = path.join(__dirname, 'uploads', filename);
    // 确保文件路径在 uploads 目录内
    const resolvedPath = path.resolve(filePath);
    const uploadsDir = path.resolve(path.join(__dirname, 'uploads'));
    if (!resolvedPath.startsWith(uploadsDir)) {
      return res.status(403).json({ success: false, error: '非法的文件路径' });
    }
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      fs.unlinkSync(resolvedPath);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: '文件不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/delete/folder/:foldername', (req, res) => {
  try {
    const foldername = req.params.foldername;
    if (!validateFilename(foldername)) {
      return res.status(400).json({ success: false, error: '无效的文件夹名' });
    }
    const folderPath = path.join(__dirname, 'uploads', foldername);
    // 确保文件夹路径在 uploads 目录内
    const resolvedPath = path.resolve(folderPath);
    const uploadsDir = path.resolve(path.join(__dirname, 'uploads'));
    if (!resolvedPath.startsWith(uploadsDir)) {
      return res.status(403).json({ success: false, error: '非法的文件夹路径' });
    }
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
      fs.rmSync(resolvedPath, { recursive: true, force: true });
      res.json({ success: true, message: `文件夹 "${foldername}" 已删除` });
    } else {
      res.status(404).json({ success: false, error: '文件夹不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/clear/images', (req, res) => {
  try {
    const uploadDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadDir)) {
      fs.readdirSync(uploadDir).forEach(file => {
        const filePath = path.join(uploadDir, file);
        if (fs.statSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      });
    }
    res.json({ success: true, message: '已清空所有图片和文件夹' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/download/zip', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { filenames } = req.body;
    if (!filenames || filenames.length === 0) {
      return res.status(400).json({ success: false, error: '没有文件需要下载' });
    }
    
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const zip = new JSZip();
    
    // 添加所有Excel文件到ZIP
    for (const filename of filenames) {
      const filePath = path.join(__dirname, 'temp', filename);
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath);
        zip.file(filename, fileContent);
      }
    }
    
    // 生成ZIP并发送
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="批量生成的Excel文件.zip"');
    res.send(zipBuffer);
    
  } catch (error) {
    console.error('ZIP下载错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/status', (req, res) => {
  const uploadDir = path.join(__dirname, 'uploads');
  const templatesDir = path.join(__dirname, 'templates');
  
  let folderCount = 0;
  let imageCount = 0;
  let templatesCount = 0;
  
  if (fs.existsSync(uploadDir)) {
    const items = fs.readdirSync(uploadDir);
    folderCount = items.filter(f => fs.statSync(path.join(uploadDir, f)).isDirectory()).length;
    items.filter(f => !fs.statSync(path.join(uploadDir, f)).isDirectory() && isImageFile(f))
      .forEach(f => imageCount++);
  }
  
  if (fs.existsSync(templatesDir)) {
    templatesCount = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json')).length;
  }
  
  res.json({ 
    status: 'running',
    port: PORT,
    uploadsDir: uploadDir,
    folderCount: folderCount,
    imageCount: imageCount,
    templatesCount: templatesCount,
    timestamp: new Date().toISOString()
  });
});

// 添加停止服务器路由
app.post('/stop', (req, res) => {
  res.json({ success: true, message: '服务器正在停止...' });
  // 延迟关闭以确保响应已发送
  setTimeout(() => {
    server.close(() => {
      console.log('服务器已停止');
      process.exit(0);
    });
  }, 500);
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ 
    success: false, 
    error: err.message || '服务器内部错误',
    type: err.code || 'INTERNAL_ERROR'
  });
});

const server = http.createServer(app);

const MAX_PORT_ATTEMPTS = 20; // 限制最大尝试次数

function startServer(port = PORT, attempt = 0) {
  return new Promise((resolve, reject) => {
    if (attempt >= MAX_PORT_ATTEMPTS) {
      reject(new Error(`无法找到可用端口，已尝试 ${MAX_PORT_ATTEMPTS} 次`));
      return;
    }
    
    server.listen(port, '0.0.0.0', () => {
      console.log(`\n✅ Excel批量生成工具v2已启动！`);
      console.log(`🌐 访问地址: http://localhost:${port}`);
      console.log(`📁 图片上传目录: ${path.join(__dirname, 'uploads')}`);
      console.log(`📋 模板存储目录: ${path.join(__dirname, 'templates')}`);
      console.log(`\n按 Ctrl+C 停止服务器\n`);
      resolve(port);
    });
    
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`端口 ${port} 已被占用，尝试端口 ${port + 1}...`);
        server.removeAllListeners();
        startServer(port + 1, attempt + 1).then(resolve).catch(reject);
      } else {
        reject(error);
      }
    });
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let port = PORT;
  
  if (args.includes('--port')) {
    const portIndex = args.indexOf('--port') + 1;
    if (portIndex < args.length) {
      port = parseInt(args[portIndex]);
    }
  }
  
  startServer(port);
}

module.exports = { app, startServer };