const request = require("supertest");
const app = require("../server");   // you'll need to export app from server.js first

describe("Identity Provider", () => {

  test("GET /health returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  test("POST /login succeeds with valid credentials", async () => {
    const res = await request(app)
      .post("/login")
      .send({ email: "tonoy@iut-dhaka.edu", password: "tonoy123" });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test("POST /login fails with wrong password", async () => {
    const res = await request(app)
      .post("/login")
      .send({ email: "tonoy@iut-dhaka.edu", password: "wrongpassword" });
    expect(res.statusCode).toBe(401);
  });

  test("POST /login fails with missing fields", async () => {
    const res = await request(app).post("/login").send({});
    expect(res.statusCode).toBe(400);
  });

  test("GET /verify rejects request with no token", async () => {
    const res = await request(app).get("/verify");
    expect(res.statusCode).toBe(401);
  });

});