'use strict';

const path = require('path');
const database = require('sqlite-async');
const program = require('commander');
const moment = require('moment');
const axios = require('axios');

const main = async() => {
  try {
    const filename = moment().format('Y-M-D H:m:s');
    const db_name = path.join(__dirname, 'db', `${filename}.db`);
    let db = await database.open(db_name);
    console.log(`Successful connection to the database ${filename}.db`);

    const sql_create = `CREATE TABLE IF NOT EXISTS motdata (
        registration TEXT,
        make TEXT,
        model TEXT,
        date DATETIME,
        result TEXT,
        reason TEXT NULL,
        type TEXT NULL
      );`;
    await db.run(sql_create);
    console.log('Successful creation of the \'motdata\' table');

    let page = 1;

    while (true) {
      console.log(`Getting page ${page}`);

      const response = await axios.get(`https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?page=${page}`);

      const insertSql = `INSERT INTO motdata
    (registration, make, model, date, result, reason, type)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;

      for (const vehicle of response.data) {
        for (const test of vehicle.motTests) {
          if (test.testResult === 'FAILED') {
            for (const reason of test.rfrAndComments) {
              await db.run(insertSql,
                vehicle.registration,
                vehicle.make,
                vehicle.model,
                test.completedDate,
                test.testResult,
                reason.text,
                reason.type)
            }
          } else {
            await db.run(insertSql,
              vehicle.registration,
              vehicle.make,
              vehicle.model,
              test.completedDate,
              test.testResult,
              null,
              null)
          }
        }
      }
      page++;
    }
  } catch (e) {
    console.log(e.message);
  }
};

program
  .option('--api [api]', 'api key')
  .parse(process.argv);

if (!program.api) {
  console.log('an api key is required')
  return;
}

axios.defaults.headers.common['x-api-key'] = program.api

main();
