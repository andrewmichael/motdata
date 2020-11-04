'use strict';

const path = require('path');
const database = require('better-sqlite3');
const program = require('commander');
const retry = require('async-retry-ng');
const axios = require('axios');
const moment = require('moment');

const db_name = path.join(__dirname, 'db', `motdata.db`);
const db = new database(db_name, {error: console.log});

axios.defaults.timeout = 10000;

program
  .option('--api [api key]', 'api key')
  .option('--create', 'creates the db structure')
  .option('--getall [start page]', 'gets all the data')
  .option('--getdate [date]', 'get mots on a date')
  .parse(process.argv);

const mainCreateDb = async() => {
  try{
    const sql_create_table = `CREATE TABLE IF NOT EXISTS motdata (
        registration TEXT,
        make TEXT,
        model TEXT,
        date DATETIME,
        result TEXT,
        reason TEXT NULL,
        type TEXT NULL
      );`

    const create = db.prepare(sql_create_table);
    create.run();

    const sql_create_index = `CREATE INDEX idx_reg_date_result
    ON motdata (registration, date, result);`;
    const index = db.prepare(sql_create_index);
    index.run();

    console.log('Successful creation of the \'motdata\' db and table');
  } catch (e) {
    console.log(e.message);
  }
}

const mainGetAll = async() => {
  try {
    let page = program.getall;
    let processing = true;
    let empty = 0;

    while (processing) {
      console.log(`Start get page ${page}`);
      const response = await retry(async (bail, iteration) => {
        try {
          return await axios.get(`https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?page=${page}`, );
        } catch (error) {
          if (error.response && error.response.status && error.response.status === 404) {
            console.log(`Page ${page} not found`);
            return{data: [], empty: true};
          }
          throw error;
        }}, {
        retries: 5,
        onRetry: (error) => {
          console.log(`an error occured ${error}`);
        }
      })

      if (response.empty) {
        empty++;
      }

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

      if (empty >5) {
        processing = false;
        console.log(`End`)
      }

      await new Promise(resolve => setTimeout(resolve, 4000));
    }
  } catch (e) {
    console.log(e.message);
  }
};

const mainGetDate = async() => {
  const pages = [...Array(1440).keys()];

  try {
    for (const page of pages) {
      console.log(`Start get page ${page} date ${program.getdate}`);
      const response = await retry(async (bail, iteration) => {
        try {
          return await axios.get(`https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?date=${program.getdate}&page=${page}`);
        } catch (error) {
          if (error.response && error.response.status && error.response.status === 404) {
            console.log(`Page ${page} not found`);
            return {data: []};
          }
          throw error;
        }}, {
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
        return [].concat(...vehicle.motTests.filter(x => moment(x.completedDate, 'YYYY.MM.DD').isSame(moment(program.getdate, 'YYYYMMDD'), 'day')).map((mot) => {
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

      await new Promise(resolve => setTimeout(resolve, 6000));
    }
  } catch (e) {
    console.log(e);
  }
};

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

if (program.getdate) {
  if (!program.api) {
    console.log('an api key is required')
    return;
  }
  axios.defaults.headers.common['x-api-key'] = program.api
  mainGetDate();
}
