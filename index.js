require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Configuration avancée CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Sécurité
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Limitation des requêtes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limite chaque IP à 100 requêtes par fenêtre
  message: 'Trop de requêtes, veuillez réessayer plus tard.'
});
app.use(limiter);

// Pool de connexions MySQL avec gestion des erreurs
let pool;
(async () => {
  try {
    pool = await mysql.createPool({
      host: process.env.DB_HOST || 'mysql-babodo.alwaysdata.net',
      user: process.env.DB_USER || 'babodo',
      password: process.env.DB_PASSWORD || 'A60zerty!',
      database: process.env.DB_NAME || 'babodo_explorateur_mboa',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    console.log('Connexion MySQL réussie ✅');
  } catch (err) {
    console.error('Erreur de connexion MySQL ❌:', err.message);
    process.exit(1); // Arrête l'application si la connexion échoue
  }
})();

// Routes
app.get('/categories', async (req, res) => {
    try {
      // Récupérer uniquement les catégories dont la langue est 'fr'
      const [rows] = await pool.query('SELECT * FROM categories WHERE langue = "fr"');
      res.json(rows);
    } catch (err) {
      console.error('Erreur lors de la récupération des catégories:', err);
      res.status(500).json({ error: 'Erreur interne du serveur' });
    }
  });
  

app.get('/pois', async (req, res) => {
    try {
      let query = `
        SELECT 
          id, 
          name AS nom, 
          description, 
          quartier_id, 
          category_id AS categorieId, 
          adress, 
          latitude, 
          longitude, 
          etoile AS rating, 
          is_verify AS verified, 
          status AS statut, 
          is_booking AS isBooking, 
          is_restaurant AS isRestaurant, 
          is_transport AS isTransport, 
          is_stadium AS isStadium, 
          is_recommand AS isRecommand, 
          langue,
          is_translate AS isTranslate,
          user_id 
        FROM point_interests
        WHERE langue = 'fr' 
      `;
  
      const params = [];
  
      // Filtrer par catégorie si nécessaire
      if (req.query.category) {
        query += ' AND category_id = ?';  // Ajouter le filtre pour la catégorie
        params.push(req.query.category);
      }
  
      const [rows] = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      console.error('Erreur lors de la récupération des POIs:', err);
      res.status(500).json({ error: 'Erreur interne du serveur' });
    }
  });
  

// Middleware pour gérer les routes inexistantes (404)
app.use((req, res, next) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API en écoute sur http://localhost:${PORT}`);
});
