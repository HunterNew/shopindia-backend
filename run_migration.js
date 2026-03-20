process.env.DATABASE_URL = 'postgresql://shopindia_db_user:imzHZwrITnoWdOAwqDb2zSSbmEjk4Zzk@dpg-d6qnf315pdvs73bdvj7g-a.oregon-postgres.render.com/shopindia_db';
process.env.NODE_ENV = 'production';
require('./src/config/migrate.js');