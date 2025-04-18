require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();


// 👉 Indique à Express qu’il est derrière un proxy (Render, Heroku, etc.)
app.set('trust proxy', true);
// Configuration avancée CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true, // Si tu utilises des cookies/session
}));

app.use(bodyParser.json()); // ← obligatoire pour parser les JSON
app.use(bodyParser.urlencoded({ extended: true }));

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

  app.post('/poi', async (req, res) => {
    // Paramètres attendus - notez 'quarter_id' et non 'quartier_id'
    const { name, adress, quartier_id, category_id, description, latitude, longitude, user_id } = req.body;
    
    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // 1. Insérer le POI principal - avec tous les champs requis
            const [result] = await connection.query(
                `INSERT INTO point_interests 
                (name, adress, quartier_id, category_id, description, latitude, longitude,
                 user_id, etoile, status, is_booking, is_restaurant, is_transport,
                 is_stadium, is_recommand, langue) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name,
                    adress,
                    quartier_id, // Doit être un ID valide de la table quarters
                    category_id,
                    description,
                    latitude,
                    longitude,
                    user_id,
                    req.body.etoile || null,
                    req.body.status || 1,
                    req.body.is_booking || 0,
                    req.body.is_restaurant || 0,
                    req.body.is_transport || 0,
                    req.body.is_stadium || 0,
                    req.body.is_recommand || 0,
                    req.body.langue || 'fr'
                ]
            );

            const poiId = result.insertId;

            // 2. Insérer les contacts
            if (req.body.contacts) {
                await connection.query(
                    `INSERT INTO contacts 
                    (email, tel, whatsapp, url, pointinteret_id) 
                    VALUES (?, ?, ?, ?, ?)`,
                    [
                        req.body.contacts.email || null,
                        req.body.contacts.tel || null,
                        req.body.contacts.whatsapp || null,
                        req.body.contacts.url || null,
                        poiId
                    ]
                );
            }

            // 3. Insérer les services
            if (req.body.services && req.body.services.length > 0) {
                for (const service of req.body.services) {
                    await connection.query(
                        `INSERT INTO services 
                        (name, description, amount, pointinteret_id, langue) 
                        VALUES (?, ?, ?, ?, ?)`,
                        [
                            service.name || 'Service sans nom',
                            service.description || null,
                            service.amount || 0,
                            poiId,
                            service.langue || 'fr'
                        ]
                    );
                }
            }

            // 4. Insérer les prix (nouveau)
            if (req.body.prices && req.body.prices.length > 0) {
                for (const price of req.body.prices) {
                    await connection.query(
                        `INSERT INTO prices 
                        (price_name, amount, pointinteret_id, langue) 
                        VALUES (?, ?, ?, ?)`,
                        [
                            price.price_name || 'Tarif sans nom',
                            price.amount || 0,
                            poiId,
                            price.langue || 'fr'
                        ]
                    );
                }
            }

            await connection.commit();
            connection.release();

            res.status(201).json({ 
                message: 'POI créé avec succès',
                poiId: poiId
            });

        } catch (err) {
            await connection.rollback();
            connection.release();
            throw err;
        }

    } catch (err) {
        console.error('Erreur lors de la création du POI:', err);
        res.status(500).json({ 
            error: 'Erreur interne du serveur',
            details: err.message 
        });
    }
});




// Récupérer un POI spécifique
app.get('/pois/:id', async (req, res) => {
  try {
      const [rows] = await pool.query('SELECT * FROM point_interests WHERE id = ?', [req.params.id]);
      if (rows.length === 0) {
          return res.status(404).json({ error: 'POI non trouvé' });
      }
      res.json(rows[0]);
  } catch (err) {
      console.error('Erreur lors de la récupération du POI:', err);
      res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});



// Mettre à jour un POI
app.put('/pois/:id', async (req, res) => {
  const poiId = req.params.id;
  const { 
      name, 
      adress, 
      quartier_id, 
      category_id, 
      description, 
      latitude, 
      longitude, 
      user_id,
      contacts,
      services,
      transports
  } = req.body;

  try {
      const connection = await pool.getConnection();
      await connection.beginTransaction();

      try {
          // 1. Mettre à jour le POI principal
          await connection.query(
              `UPDATE point_interests SET
              name = ?,
              adress = ?,
              quartier_id = ?,
              category_id = ?,
              description = ?,
              latitude = ?,
              longitude = ?,
              user_id = ?,
              updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
              [name, adress, quartier_id, category_id, description, latitude, longitude, user_id, poiId]
          );

          // 2. Mettre à jour les contacts
          if (contacts) {
              // Solution plus robuste qui évite l'erreur
              await connection.query(
                  `DELETE FROM contacts WHERE pointinteret_id = ?`,
                  [poiId]
              );

              if (contacts.email || contacts.tel || contacts.whatsapp || contacts.url) {
                  await connection.query(
                      `INSERT INTO contacts 
                      (email, tel, whatsapp, url, pointinteret_id) 
                      VALUES (?, ?, ?, ?, ?)`,
                      [
                          contacts.email || null,
                          contacts.tel || null,
                          contacts.whatsapp || null,
                          contacts.url || null,
                          poiId
                      ]
                  );
              }
          }

          // 3. Mettre à jour les services
          if (services) {
              await connection.query(
                  `DELETE FROM services WHERE pointinteret_id = ?`,
                  [poiId]
              );

              for (const service of services) {
                  if (service.name) {  // Vérification minimale
                      await connection.query(
                          `INSERT INTO services 
                          (name, description, amount, pointinteret_id, langue) 
                          VALUES (?, ?, ?, ?, 'fr')`,
                          [
                              service.name,
                              service.description || null,
                              service.amount || 0,
                              poiId
                          ]
                      );
                  }
              }
          }

          // 4. Mettre à jour les prix
          if (req.body.prices && req.body.prices.length > 0) {
            for (const price of req.body.prices) {
                if (price.id) {
                    await connection.query(
                        `UPDATE prices SET
                            price_name = ?,
                            amount = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND pointinteret_id = ?`,
                        [
                            price.price_name,
                            price.amount,
                            price.id,
                            poiId
                        ]
                    );
                } else {
                    await connection.query(
                        `INSERT INTO prices 
                        (price_name, amount, pointinteret_id, langue)
                        VALUES (?, ?, ?, ?)`,
                        [
                            price.price_name,
                            price.amount,
                            poiId,
                            price.langue || 'fr'
                        ]
                    );
                }
            }
        }

          await connection.commit();
          connection.release();

          res.json({ 
              message: 'POI mis à jour avec succès',
              poiId: poiId
          });

      } catch (err) {
          await connection.rollback();
          connection.release();
          console.error('Erreur transaction:', err);
          throw err;
      }

  } catch (err) {
      console.error('Erreur mise à jour POI:', err);
      res.status(500).json({ 
          error: 'Erreur interne du serveur',
          details: process.env.NODE_ENV === 'development' ? err.message : 'Détails cachés en production'
      });
  }
});

// Supprimer un POI
app.delete('/pois/:id', async (req, res) => {
  try {
      const [result] = await pool.query('DELETE FROM point_interests WHERE id = ?', [req.params.id]);
      if (result.affectedRows === 0) {
          return res.status(404).json({ error: 'POI non trouvé' });
      }
      res.json({ message: 'POI supprimé avec succès' });
  } catch (err) {
      console.error('Erreur lors de la suppression du POI:', err);
      res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});
  
app.get('/pois-with-details', async (req, res) => {
  try {
      const query = `
          SELECT 
              pi.*,
              c.name AS category_name,
              q.name AS quartier_name
          FROM point_interests pi
          LEFT JOIN categories c ON pi.category_id = c.id
          LEFT JOIN quartiers q ON pi.quartier_id = q.id
          WHERE pi.langue = 'fr'
      `;
      const [rows] = await pool.query(query);
      res.json(rows);
  } catch (err) {
      console.error('Erreur:', err);
      res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

  app.get('/test', (req, res) => {
    res.send('Route test OK');
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
