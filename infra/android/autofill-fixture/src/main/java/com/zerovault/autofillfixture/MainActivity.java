package com.zerovault.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.WindowManager;
import android.view.autofill.AutofillManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.PasswordCredential;
import androidx.credentials.exceptions.GetCredentialException;
import java.util.Collections;

public final class MainActivity extends Activity {
  private EditText username;
  private EditText password;
  private TextView status;
  private CancellationSignal credentialCancellation;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    setContentView(R.layout.activity_main);

    username = findViewById(R.id.fixture_username);
    password = findViewById(R.id.fixture_password);
    status = findViewById(R.id.fixture_status);
    Button autofillButton = findViewById(R.id.fixture_autofill_button);
    Button credentialButton = findViewById(R.id.fixture_credential_button);

    TextWatcher fillWatcher = new TextWatcher() {
      @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
      @Override public void onTextChanged(CharSequence value, int start, int before, int count) {}
      @Override public void afterTextChanged(Editable value) {
        if (username.length() > 0 && password.length() > 0) {
          status.setText("Username and password fields received a credential");
        }
      }
    };
    username.addTextChangedListener(fillWatcher);
    password.addTextChangedListener(fillWatcher);
    autofillButton.setOnClickListener(view -> requestAutofill());
    credentialButton.setOnClickListener(view -> requestPasswordCredential());
  }

  private void requestAutofill() {
    AutofillManager manager = getSystemService(AutofillManager.class);
    if (manager == null || !manager.isEnabled()) {
      status.setText("Android Autofill is not enabled");
      return;
    }
    username.requestFocus();
    manager.requestAutofill(username);
    status.setText("Android Autofill request sent");
  }

  private void requestPasswordCredential() {
    if (credentialCancellation != null) {
      credentialCancellation.cancel();
    }
    credentialCancellation = new CancellationSignal();
    status.setText("Waiting for Credential Manager");

    GetPasswordOption option = new GetPasswordOption(
      Collections.emptySet(),
      false,
      Collections.emptySet()
    );
    GetCredentialRequest request = new GetCredentialRequest.Builder()
      .addCredentialOption(option)
      .build();
    CredentialManager.create(this).getCredentialAsync(
      this,
      request,
      credentialCancellation,
      getMainExecutor(),
      new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
        @Override
        public void onResult(GetCredentialResponse response) {
          Credential credential = response.getCredential();
          if (!(credential instanceof PasswordCredential passwordCredential)) {
            status.setText("Credential Manager returned an unsupported credential");
            return;
          }
          username.setText(passwordCredential.getId());
          password.setText(passwordCredential.getPassword());
          status.setText("Credential Manager returned a password credential");
        }

        @Override
        public void onError(GetCredentialException error) {
          status.setText("Credential request was canceled or unavailable");
        }
      }
    );
  }

  @Override
  protected void onDestroy() {
    if (credentialCancellation != null) {
      credentialCancellation.cancel();
    }
    super.onDestroy();
  }
}
