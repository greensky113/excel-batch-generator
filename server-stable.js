const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const sharp = require('sharp');
const JSZip = require('jszip');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const PORT = 8080;

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

// 图片上传配置
const imageUpload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    // 检查扩展名是否支持
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      // 如果扩展名不匹配，也检查一下 MIME 类型
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('不支持的图片格式，请上传 .jpg, .jpeg, .png, .gif, .bmp, .webp 格式的图片'), false);
      }
    }
  }
});

// ZIP 文件上传配置（不限制格式）
const zipUpload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('请上传 .zip 格式的文件'), false);
    }
  }
});

const SECURITY_CONFIG = {
  MAX_ZIP_SIZE: 100 * 1024 * 1024,
  MAX_FILES_PER_ZIP: 1000,
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
};

function isImageFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return SECURITY_CONFIG.ALLOWED_EXTENSIONS.includes(ext);
}

app.post('/upload/images', imageUpload.array('images', 100), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: '没有上传图片' });
    }
    
    const files = req.files.map(file => ({
      originalName: file.originalname,
      filename: file.filename,
      path: `/uploads/${file.filename}`,
      size: file.size
    }));
    
    res.json({ success: true, files: files, message: `成功上传 ${files.length} 张图片` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
    
    const data = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(data);
    
    const zipEntries = Object.keys(zip.files);
    
    if (zipEntries.length > SECURITY_CONFIG.MAX_FILES_PER_ZIP) {
      fs.unlinkSync(zipPath);
      return res.status(400).json({ 
        success: false, 
        error: `ZIP 文件包含过多文件，最大允许 ${SECURITY_CONFIG.MAX_FILES_PER_ZIP} 个` 
      });
    }
    
    const folders = [];
    const processedFiles = [];
    
    for (const zipEntry of zipEntries) {
      const entry = zip.files[zipEntry];
      
      if (entry.dir) continue;
      
      if (entry._data && entry._data.uncompressedSize > SECURITY_CONFIG.MAX_FILE_SIZE) {
        continue;
      }
      
      const relativePath = entry.name.replace(/^[\s\/]+/, '');
      if (!relativePath) continue;
      
      if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
        continue;
      }
      
      const parts = relativePath.split('/');
      
      if (parts.length >= 2) {
        const folderName = parts[0];
        const fileName = parts[parts.length - 1];
        
        if (!fileName || !isImageFile(fileName)) continue;
        
        if (!validateFilename(folderName) || !validateFilename(fileName)) {
          continue;
        }
        
        const folderPath = path.join(outputDir, folderName);
        
        if (!fs.existsSync(folderPath)) {
          fs.mkdirSync(folderPath, { recursive: true });
        }
        
        const filePath = path.join(folderPath, fileName);
        const resolvedPath = path.resolve(filePath);
        const uploadsDir = path.resolve(outputDir);
        if (!resolvedPath.startsWith(uploadsDir)) {
          continue;
        }
        
        const content = await entry.async('nodebuffer');
        fs.writeFileSync(resolvedPath, content);
        
        if (!folders.includes(folderName)) {
          folders.push(folderName);
        }
        
        processedFiles.push({
          folder: folderName,
          file: fileName,
          path: `/uploads/${folderName}/${fileName}`
        });
      }
    }
    
    fs.unlinkSync(zipPath);
    
    res.json({
      success: true,
      message: `成功导入 ${folders.length} 个文件夹，共 ${processedFiles.length} 张图片`,
      folders: folders,
      files: processedFiles
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
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
        createdAt: new Date().toISOString()
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
        const stats = fs.statSync(filepath);
        const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        return {
          filename: file,
          name: content.name,
          createdAt: stats.birthtime,
          updatedAt: stats.mtime
        };
      });
    
    res.json({ success: true, templates: files });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/template/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (!validateFilename(filename)) {
      return res.status(400).json({ success: false, error: '无效的文件名' });
    }
    
    const templatesDir = path.join(__dirname, 'templates');
    const filepath = path.join(templatesDir, filename);
    
    if (fs.existsSync(filepath)) {
      const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      res.json({ success: true, template: content });
    } else {
      res.status(404).json({ success: false, error: '模板不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/template/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (!validateFilename(filename)) {
      return res.status(400).json({ success: false, error: '无效的文件名' });
    }
    
    const templatesDir = path.join(__dirname, 'templates');
    const filepath = path.join(templatesDir, filename);
    
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: '模板不存在' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/validate/data', express.json({ limit: '50mb' }), (req, res) => {
  try {
    const { data, template } = req.body;
    
    if (!data || !template) {
      return res.status(400).json({ success: false, error: '缺少数据或模板' });
    }
    
    const errors = [];
    const warnings = [];
    
    const dataFields = Object.keys(data[0] || {});
    const templateFields = new Set();
    const imageFields = [];
    const matchedFolders = new Set();
    const unmatchedFolders = new Set();
    const availableFolders = [];
    
    const uploadDir = path.join(__dirname, 'uploads');
    if (fs.existsSync(uploadDir)) {
      fs.readdirSync(uploadDir)
        .filter(file => fs.statSync(path.join(uploadDir, file)).isDirectory())
        .forEach(folder => availableFolders.push(folder));
    }
    
    template.sheets?.forEach(sheet => {
      sheet.fields?.forEach(field => {
        if (field.name) templateFields.add(field.name);
        if (field.type === 'image') imageFields.push(field.name);
      });
    });
    
    data.forEach((row, index) => {
      if (!row || typeof row !== 'object') {
        errors.push(`第 ${index + 1} 行数据格式不正确`);
        return;
      }
      
      template.sheets?.forEach(sheet => {
        sheet.fields?.forEach(field => {
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
          fileCount: files.length,
          files: files.map(file => ({
            name: file.name,
            path: `/uploads/${folderName}/${file.name}`
          }))
        };
      });
    
    res.json({ success: true, folders: folders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 兼容旧的路由名称
app.get('/list/folders', (req, res) => {
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
          fileCount: files.length,
          files: files.map(file => ({
            name: file.name,
            path: `/uploads/${folderName}/${file.name}`
          }))
        };
      });
    
    res.json({ success: true, folders: folders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除所有图片和文件夹
app.delete('/delete/all-images', (req, res) => {
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

function validateFilename(filename) {
  if (!filename) return false;
  const forbiddenChars = /[<>:"/\\|?*\x00-\x1F]/;
  if (forbiddenChars.test(filename)) return false;
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
    status: 'ok',
    port: PORT,
    uploadsDir: uploadDir,
    folderCount: folderCount,
    imageCount: imageCount,
    templatesCount: templatesCount,
    timestamp: new Date().toISOString()
  });
});

app.post('/stop', (req, res) => {
  res.json({ success: true, message: '服务器正在停止...' });
  setTimeout(() => {
    server.close(() => {
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

let currentPort = PORT;

function startServer(port) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log('\n✅ Excel批量生成工具v2已启动！');
    console.log(`🌐 访问地址: http://localhost:${port}`);
    console.log(`📁 图片上传目录: ${path.join(__dirname, 'uploads')}`);
    console.log(`📋 模板存储目录: ${path.join(__dirname, 'templates')}`);
    console.log(`\n按 Ctrl+C 停止服务器\n`);
    console.log('等待连接...');
  });
  
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 已被占用，尝试端口 ${port + 1}...`);
      server.close();
      setTimeout(() => startServer(port + 1), 100);
    } else {
      console.error('服务器启动错误:', error);
    }
  });
}

startServer(currentPort);
