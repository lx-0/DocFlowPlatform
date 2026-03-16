const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const ssoController = require('../controllers/ssoController');
const ldapController = require('../controllers/ldapController');

router.post('/register', authController.register);
router.post('/login', authController.login);

// LDAP routes — gracefully return 501 when LDAP is not configured
router.post('/ldap/login', ldapController.login);

// SSO routes — gracefully return 501 when SSO is not configured
router.get('/sso/login', ssoController.login);
router.post('/sso/callback', ssoController.callback); // SAML ACS
router.get('/sso/callback', ssoController.callback);  // OIDC redirect URI
router.get('/sso/metadata', ssoController.metadata);  // SAML SP metadata

module.exports = router;
