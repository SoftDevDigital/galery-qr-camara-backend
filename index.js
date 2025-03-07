import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';

const app = express();
const port = process.env.SERVER_PORT;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Configura AWS S3 (Versión 3)
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Configura multer-s3 (Versión 3)
const upload = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: process.env.S3_BUCKET_NAME,
        // acl: 'public-read',
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            cb(null, Date.now().toString() + '-' + file.originalname);
        },
    }),
});

// Middleware para servir archivos estáticos (HTML)
app.use(cors());
app.use(bodyParser.json()); // Analiza el cuerpo de las solicitudes JSON
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb'  }));

// Función para obtener la lista de imágenes desde S3
async function getImagesFromS3() {
  const params = {
      Bucket: 'qr-nodejs-bucket-20250302-aws-s3',
  };

  try {
      const command = new ListObjectsV2Command(params);
      const data = await s3Client.send(command);

      if (data.Contents) {
          // Fuerza la obtención de la región como una cadena
          let region = s3Client.config.region;
          if (typeof region === 'function') {
              region = await region(); // Si es una función, la ejecutamos
          }

          return data.Contents.map(item => `https://${params.Bucket}.s3.${region}.amazonaws.com/${item.Key}`);
      } else {
          return [];
      }
  } catch (error) {
      console.error('Error al obtener la lista de imágenes:', error);
      return [];
  }
}

// Ruta para recuperar la imagen (ejemplo)
app.get('/image/:filename', (req, res) => {
  const filename = req.params.filename;
  const imageUrl = `https://test-bucket-2025.s3.us-east-2.amazonaws.com/${filename}`; // Genera la URL de la imagen

  res.send(`<img src="${imageUrl}" alt="${filename}">`); // Muestra la imagen en el navegador
});

// Ruta para obtener la lista de imágenes
app.get('/images', async (req, res) => {
  const params = {
      Bucket: 'qr-nodejs-bucket-20250302-aws-s3',
  };

  try {
      const command = new ListObjectsV2Command(params);
      const data = await s3Client.send(command);

      if (data.Contents) {
          const imageUrls = data.Contents.map(item => `https://test-bucket-2025.s3.us-east-2.amazonaws.com/${item.Key}`);
          res.json(imageUrls);
      } else {
          res.json([]); // No hay imágenes en el bucket
      }
  } catch (error) {
      console.error('Error al obtener la lista de imágenes:', error);
      res.status(500).send('Error al obtener la lista de imágenes.');
  }
});

// Ruta para subir un solo archivo
app.post('/upload', upload.single('image'), async (req, res) => {   
    if (!req.file) {
      return res.status(400).send('No se ha subido ningún archivo.');
    }

    res.send({
      message: 'Imagen subida con éxito.',
      location: req.file.location,
    });

    // Obtiene la lista de imágenes actualizada y la emite a través de Socket.IO
    const imageUrls = await getImagesFromS3();
    io.emit('imagesUpdated', imageUrls);
});


// Ruta para generar QR
app.get('/api/qr', async (req, res) => {
    const text = req.query.text || 'Texto por defecto';
    try {
        const qrCode = await qr.toDataURL(text, { errorCorrectionLevel: 'H' });
        res.send(`<img src="${qrCode}" />`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al generar el código QR');
    }
});





//******************************************************** */
const server = http.createServer(app);

// Configura Socket.IO
const io = new Server(server);

io.on('connection', async (socket) => {
    console.log('Cliente conectado');

    // Envía la lista inicial de imágenes al cliente cuando se conecta
    const imageUrls = await getImagesFromS3();
    socket.emit('imagesUpdated', imageUrls);

    socket.on('disconnect', () => {
        console.log('Cliente desconectado');
    });
});

server.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});