const { apiHandler } = require('./api-handler');

module.exports = route => async (req, res) => {
  const originalUrl = req.url;
  req.url = `/api/${route}`;
  try {
    return await apiHandler(req, res);
  } finally {
    req.url = originalUrl;
  }
};
