var app = require('application');
var dialogs = require('ui/dialogs');
var utils = require('utils/utils');
var Observable = require('data/observable').Observable;

// Native Android classes declarations
var Snackbar = android.support.design.widget.Snackbar;
var KeyguardManager = android.app.KeyguardManager;
var KeyGenParameterSpec = android.security.keystore.KeyGenParameterSpec;
var KeyProperties = android.security.keystore.KeyProperties;
var KeyStore = java.security.KeyStore;

var Cipher = javax.crypto.Cipher;
var KeyGenerator = javax.crypto.KeyGenerator;
var SecretKey = javax.crypto.SecretKey;

// Constants
var KEYGUARD_SYSTEM_SERVICE = 'keyguard';
var KEY_NAME = 'nativescript_rocks';
var SECRET_BYTE_ARRAY = Array.create('byte', 16);
var REQUEST_CODE_CONFIRM_DEVICE_CREDENTIALS = 1;
var TRANSFORMATION = 'AES/CBC/PKCS7Padding';
var AUTHENTICATION_DURATION = 15; // in seconds

// Global variables
var activity = null;
var page = null;
var keyguardManager = null;
var onLoadedEventTimesFiredCount = 0;

var viewModel = new Observable({
  onTap: function onTap() {
    if (tryEncrypt(true)) {
      Snackbar.make(page.android, 'You have already been authenticated in the last '
        + AUTHENTICATION_DURATION + ' seconds!', 3000).show();
      this.authStatus.msg = 'You have already provided valid credentials in the last ' + AUTHENTICATION_DURATION + ' seconds.';
    }
  },
  compatibilityStatus: new Observable({
    compatible: true,
    msg: 'Your device is compatible.'
  }),
  authStatus: new Observable ({
    msg: "You haven't been authenticated in the last " + AUTHENTICATION_DURATION + ' seconds.',
  })
});

function onLoaded(args) {
  // since we are starting an external activity,
  // onLoaded() is fired each time we come back
  onLoadedEventTimesFiredCount += 1;
  activity = app.android.foregroundActivity;
  page = args.object;
  keyguardManager = utils.ad.getApplicationContext().getSystemService(KEYGUARD_SYSTEM_SERVICE);

  /**
   * In Java the following function assignment translates to:
   * @Override
   * protected void onActivityResult(int requestCode, int resultCode, Intent data) { ... }
   */
  activity.onActivityResult = function onActivityResult(requestCode, resultCode, data) {
    if (requestCode === REQUEST_CODE_CONFIRM_DEVICE_CREDENTIALS) {
      if (resultCode === android.app.Activity.RESULT_OK) {
        // the user has just authenticated via the ConfirmDeviceCredential activity
        Snackbar.make(page.android, 'Authentication was successful!', 3000).show();
        viewModel.authStatus.msg = 'Congrats! You have just been authenticated successfully!';
      } else {
        // the user has quit the activity without providing credentials
        Snackbar.make(page.android, 'Authentication was cancelled!', 3000).show();
        viewModel.authStatus.msg = 'The last authentication attempt was cancelled.';
      }
    }
  };

  if (keyguardManager == null) {
    viewModel.compatibilityStatus.compatible = false;
    viewModel.compatibilityStatus.msg = 'Sorry, your device does not support KeyguardManager.';
  }

  // the user must first set up a lock screen
  // in order to use the Confirm Credential functionality
  if (keyguardManager && !keyguardManager.isKeyguardSecure()) {
    viewModel.compatibilityStatus.compatible = false;
    viewModel.compatibilityStatus.msg = 'Secure lock screen hasn\'t been set up.\n'
      + 'Go to "Settings -> Security -> Screenlock" to set up a lock screen.';
  }

  // we want this to run only when we first open the application
  if (onLoadedEventTimesFiredCount === 1 && viewModel.compatibilityStatus.compatible) {
    createKey();
    tryEncrypt(false); // check if the user has been authenticated outside the app
  }

  page.bindingContext = viewModel;
}

/**
 * Creates a symmetric key in the Android Key Store which can only be used after the user has
 * authenticated with device credentials within the last X seconds.
 */
function createKey() {
  try {
    var keyStore = KeyStore.getInstance('AndroidKeyStore');
    keyStore.load(null);
    var keyGenerator = KeyGenerator.getInstance('AES', 'AndroidKeyStore');

    keyGenerator.init(
      new KeyGenParameterSpec.Builder(KEY_NAME, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes([KeyProperties.BLOCK_MODE_CBC])
        .setUserAuthenticationRequired(true)
        .setUserAuthenticationValidityDurationSeconds(AUTHENTICATION_DURATION)
        .setEncryptionPaddings([KeyProperties.ENCRYPTION_PADDING_PKCS7])
        .build()
    );
    keyGenerator.generateKey();
  } catch (error) {
    // checks if the AES algorithm is implemented by the AndroidKeyStore
    if ((error.nativeException + '').indexOf('java.security.NoSuchAlgorithmException:') > -1) {
      viewModel.compatibilityStatus.compatible = 'almost';
      viewModel.compatibilityStatus.msg = 'You need a device with API level >= 23 in order to detect if the user ' +
                                'has already been authenticated in the last ' + AUTHENTICATION_DURATION + ' seconds.'
    }
  }
}

/**
 * Tries to encrypt the previously created symmetric key.
 * The process will succeed only if the user has already been
 * authenticated in the last AUTHENTICATION_DURATION seconds.
 * If the user is not already authenticated, an authentication screen
 * will show up for the user to provide their credentials.
 *
 * @param {boolean} isInvokedByUI - this function is called once before the user clicks the button,
 *                                  in order to detect if he had already authenticated outside the app
 */
function tryEncrypt(isInvokedByUI) {
  try {
    var keyStore = KeyStore.getInstance('AndroidKeyStore');
    keyStore.load(null);
    var secretKey = keyStore.getKey(KEY_NAME, null);

    var cipher = Cipher.getInstance(TRANSFORMATION);
    cipher.init(Cipher.ENCRYPT_MODE, secretKey);
    cipher.doFinal(SECRET_BYTE_ARRAY);

    // if no exceptions are thrown by now,
    // the user has already provided their credentials
    // in the last AUTHENTICATION_DURATION seconds
    viewModel.authStatus.msg = 'You have already provided valid credentials in the last ' + AUTHENTICATION_DURATION + ' seconds.';
    return true;
  } catch (error) {
    if ((error.nativeException + '').indexOf('android.security.keystore.UserNotAuthenticatedException') > -1) {
      // the user must provide their credentials in order to proceed
      if (isInvokedByUI) {
        showAuthenticationScreen();
      }
    } else {
      viewModel.authStatus.msg = 'Something unexpected happened. Please look at the console logs.';
      console.log(error);
    }

    return false;
  }
}

/**
 * Starts the built-in Android ConfirmDeviceCredential activity.
 */
function showAuthenticationScreen() {
  // title and description are optional, if you want the defaults,
  // you must pass nulls to the factory function
  var title = 'Please confirm your credentials.';
  var description = 'We are doing this for your own security.';
  var intent = keyguardManager.createConfirmDeviceCredentialIntent(title, description);

  if (intent != null) {
    activity.startActivityForResult(intent, REQUEST_CODE_CONFIRM_DEVICE_CREDENTIALS);
  }
}
exports.onLoaded = onLoaded;