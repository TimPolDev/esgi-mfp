import { DataSource } from "typeorm";

const datasource = new DataSource({
  type: "postgres",
  host: "localhost",
  username: "postgres",
  password: "supersecret",
  database: "postgres",
  entities: [__dirname + "/entities/**/*.{js,ts}"],
  logging: true,
  synchronize: true,
});

export default datasource;
