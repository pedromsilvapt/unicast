// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  development: {
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: './storage/database.db'
    },
    migrations: {
      directory: './lib/Database/Migrations'
    }
  }
};
