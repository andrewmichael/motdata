'use strict';

const path = require('path');
const database = require('better-sqlite3');
const program = require('commander');
const retry = require('async-retry-ng');
const axios = require('axios');

const db_name = path.join(__dirname, 'db', `motdata.db`);
const db = new database(db_name, {error: console.log});

const mainCreateDb = async() => {
  try{
    const sql_create = `CREATE TABLE IF NOT EXISTS motdata (
        registration TEXT,
        make TEXT,
        model TEXT,
        date DATETIME,
        result TEXT,
        reason TEXT NULL,
        type TEXT NULL
      );`;
    const create = db.prepare(sql_create);
    create.run();

    console.log('Successful creation of the \'motdata\' db and table');
  } catch (e) {
    console.log(e.message);
  }
}

const mainGetAll = async() => {
  try {
    let page = 0;

    while (true) {
      console.log(`Start get page ${page}`);
      const response = await retry(async (bail, iteration) => {
        return await axios.get(`https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?page=${page}`);
      }, {
        retries: 5,
        onRetry: (error) => {
          console.log(`an error occured ${error}`);
        }
      })
      console.log(`End get page ${page}`);

      console.log('Start Insert into db');
      const insertSql = `INSERT INTO motdata
      (registration, make, model, date, result, reason, type)
      VALUES (@registration, @make, @model, @date, @result, @reason, @type)`;

      const insert = db.prepare(insertSql);
      const insertMany = db.transaction((mots) => {
        for (const mot of mots) {
          insert.run(mot);
        }
      });

      const vehiclesMots = [].concat(...response.data.map((vehicle) => {
        return [].concat(...vehicle.motTests.map((mot) => {
          if (mot.testResult === 'FAILED') {
            return mot.rfrAndComments.map((comment) => {
              return {
                registration: vehicle.registration,
                make: vehicle.make,
                model: vehicle.model,
                date: mot.completedDate,
                result: mot.testResult,
                reason: comment.text,
                type: comment.type
              }
            });
          } else
            return [{
              registration: vehicle.registration,
              make: vehicle.make,
              model: vehicle.model,
              date: mot.completedDate,
              result: mot.testResult,
              reason: null,
              type: null
            }]
        }));
      }));

      insertMany(vehiclesMots);

      console.log(`End insert into db ${vehiclesMots.length}`);

      page++;
    }
  } catch (e) {
    console.log(e.message);
  }
};

program
  .option('--api [api]', 'api key')
  .option('--create', 'creates the db structure')
  .option('--getall', 'gets all the data')
  .option('--getdate [date]', 'get mots on a date')
  .parse(process.argv);



if (program.create) {
  mainCreateDb();
}

if (program.getall) {
  if (!program.api) {
    console.log('an api key is required')
    return;
  }
  axios.defaults.headers.common['x-api-key'] = program.api
  mainGetAll();
}
