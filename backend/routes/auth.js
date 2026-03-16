const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const ssoController = require('../controllers/ssoController');

router.post('/register', authController.register);
router.post('/login', authController.login);

// SSO routes — gracefully return 501 when SSO is not configured
router.get('/sso/login', ssoController.login);
router.post('/sso/callback', ssoController.callback); // SAML ACS
router.get('/sso/callback', ssoController.callback);  // OIDC redirect URI
router.get('/sso/metadata', ssoController.metadata);  // SAML SP metadata

module.exports = router;
