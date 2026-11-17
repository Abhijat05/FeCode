import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type {
  StoredProviderProfile,
  ProviderProfileStore,
  CredentialStore,
  ConnectionTestResult,
  DiscoveredModel
} from "@fecode/agent";
import {
  testProviderConnection,
  discoverAvailableModels,
  getCuratedDefaultModels,
  sanitizeApiKey,
  sanitizeBaseUrl
} from "@fecode/agent";
import { EnhancedTextInput } from "./EnhancedTextInput.js";

export interface ProviderManagementViewProps {
  initialMode?: "onboarding" | "list" | "add" | "edit" | "show" | "test" | "confirm-delete";
  selectedProfileId?: string;
  profileStore: ProviderProfileStore;
  credentialStore: CredentialStore;
  onActivateProfile?: (profile: StoredProviderProfile) => Promise<void>;
  onClose: () => void;
  terminalColumns?: number;
  terminalRows?: number;
}

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string;
  defaultBaseUrl?: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: "gemini", name: "Google Gemini", defaultModel: "gemini-2.5-flash" },
  { id: "openai", name: "OpenAI", defaultModel: "gpt-4o" },
  { id: "ollama", name: "Ollama", defaultModel: "qwen2.5-coder", defaultBaseUrl: "http://localhost:11434/v1" },
  { id: "openai-compatible", name: "OpenAI-compatible", defaultModel: "deepseek-ai/deepseek-v4.1-flash", defaultBaseUrl: "https://integrate.api.nvidia.com/v1" }
];

export const ProviderManagementView: React.FC<ProviderManagementViewProps> = ({
  initialMode = "onboarding",
  selectedProfileId: initialSelectedId,
  profileStore,
  credentialStore: _credentialStore,
  onActivateProfile,
  onClose,
  terminalColumns: _terminalColumns = 80,
  terminalRows: _terminalRows = 24
}) => {
  const [mode, setMode] = useState<"onboarding-select" | "list" | "form" | "testing" | "show" | "confirm-delete">(
    initialMode === "onboarding" || initialMode === "add"
      ? "onboarding-select"
      : initialMode === "show"
        ? "show"
        : initialMode === "confirm-delete"
          ? "confirm-delete"
          : "list"
  );

  const [profiles, setProfiles] = useState<StoredProviderProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | undefined>();
  const [selectedListIndex, setSelectedListIndex] = useState(0);
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);

  // Form states
  const [editingProfileId, setEditingProfileId] = useState<string | undefined>();
  const [formProviderId, setFormProviderId] = useState("gemini");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formFieldIndex, setFormFieldIndex] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  // Model discovery states
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>(() =>
    getCuratedDefaultModels("gemini")
  );
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [modelSelectIndex, setModelSelectIndex] = useState(0);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const discoveryAbortRef = useRef<AbortController | null>(null);

  // Connection test states
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const testAbortControllerRef = useRef<AbortController | null>(null);

  // Abort in-flight discovery on unmount
  useEffect(() => {
    return () => {
      if (discoveryAbortRef.current) {
        discoveryAbortRef.current.abort();
      }
    };
  }, []);

  // Load profiles on mount and mode change
  const reloadProfiles = useCallback(async () => {
    try {
      const list = await profileStore.getProfiles();
      const active = await profileStore.getActiveProfile();
      setProfiles(list);
      setActiveProfileId(active?.id);
    } catch {
      // Ignore load error
    }
  }, [profileStore]);

  useEffect(() => {
    reloadProfiles();
  }, [reloadProfiles]);

  // When initialSelectedId is provided, focus that profile
  useEffect(() => {
    if (initialSelectedId && profiles.length > 0) {
      const idx = profiles.findIndex((p) => p.id === initialSelectedId);
      if (idx >= 0) {
        setSelectedListIndex(idx);
      }
    }
  }, [initialSelectedId, profiles]);

  // Auto-fill form when entering form mode
  const setupFormForProvider = (providerId: string, profileToEdit?: StoredProviderProfile) => {
    const opt = PROVIDER_OPTIONS.find((p) => p.id === providerId) || PROVIDER_OPTIONS[0];
    setFormProviderId(providerId);
    setFormError(null);
    setFormFieldIndex(0);

    const curated = getCuratedDefaultModels(providerId);
    setDiscoveredModels(curated);
    setIsDiscovering(false);
    setDiscoveryError(null);

    if (profileToEdit) {
      setEditingProfileId(profileToEdit.id);
      setFormDisplayName(profileToEdit.displayName);
      setFormModel(profileToEdit.model);
      setFormBaseUrl(profileToEdit.baseUrl || opt.defaultBaseUrl || "");
      setFormApiKey(""); // Do not show existing secret
      const matchIdx = curated.findIndex((m) => m.id === profileToEdit.model);
      if (matchIdx >= 0) {
        setModelSelectIndex(matchIdx);
        setIsCustomModel(false);
      } else {
        setModelSelectIndex(curated.length);
        setIsCustomModel(true);
      }
    } else {
      setEditingProfileId(undefined);
      setFormDisplayName(opt.name === "OpenAI-compatible" ? "NVIDIA NIM" : opt.name);
      setFormModel(opt.defaultModel);
      setFormBaseUrl(opt.defaultBaseUrl || "");
      setFormApiKey("");
      const matchIdx = curated.findIndex((m) => m.id === opt.defaultModel);
      setModelSelectIndex(matchIdx >= 0 ? matchIdx : 0);
      setIsCustomModel(false);
    }
    setMode("form");
  };

  const currentProfile = profiles[selectedListIndex] || null;

  // Run connection test
  const startConnectionTest = async (options: {
    providerId: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  }) => {
    setIsTesting(true);
    setTestResult(null);
    setMode("testing");

    const abortController = new AbortController();
    testAbortControllerRef.current = abortController;

    try {
      const cleanApiKey = sanitizeApiKey(options.apiKey);
      const cleanBaseUrl = sanitizeBaseUrl(options.baseUrl);
      const result = await testProviderConnection({
        providerId: options.providerId,
        model: options.model,
        apiKey: cleanApiKey || undefined,
        baseUrl: cleanBaseUrl,
        signal: abortController.signal
      });
      setTestResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({
        success: false,
        providerId: options.providerId,
        model: options.model,
        steps: { authentication: "failed", modelAvailable: "failed" },
        durationMs: 0,
        message: msg
      });
    } finally {
      setIsTesting(false);
      testAbortControllerRef.current = null;
    }
  };

  // Save profile and clean up sensitive buffers
  const handleSaveProfile = async () => {
    try {
      const cleanApiKey = sanitizeApiKey(formApiKey);
      const cleanBaseUrl = sanitizeBaseUrl(formBaseUrl);
      const saved = await profileStore.saveProfile({
        id: editingProfileId,
        providerId: formProviderId,
        displayName: formDisplayName.trim() || formProviderId,
        model: formModel.trim(),
        baseUrl: cleanBaseUrl,
        apiKey: cleanApiKey || undefined
      });

      // Clear memory buffer of secret
      setFormApiKey("");

      if (onActivateProfile) {
        await onActivateProfile(saved);
      }

      await reloadProfiles();

      if (initialMode === "onboarding") {
        onClose();
      } else {
        setMode("list");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setFormError(`Failed to save profile: ${msg}`);
      setMode("form");
    }
  };

  // Calculate field list for form mode
  const getFormFields = useCallback(() => {
    switch (formProviderId) {
      case "gemini":
        return [
          { id: "apiKey", label: "API Key", value: formApiKey, setValue: setFormApiKey, mask: "*" },
          { id: "model", label: "Model ID", value: formModel, setValue: setFormModel }
        ];
      case "openai":
        return [
          { id: "apiKey", label: "API Key", value: formApiKey, setValue: setFormApiKey, mask: "*" },
          { id: "model", label: "Model ID", value: formModel, setValue: setFormModel },
          { id: "baseUrl", label: "Base URL (optional)", value: formBaseUrl, setValue: setFormBaseUrl }
        ];
      case "ollama":
        return [
          { id: "baseUrl", label: "Base URL", value: formBaseUrl, setValue: setFormBaseUrl },
          { id: "model", label: "Model ID", value: formModel, setValue: setFormModel }
        ];
      case "openai-compatible":
        return [
          { id: "displayName", label: "Provider Name", value: formDisplayName, setValue: setFormDisplayName },
          { id: "baseUrl", label: "Base URL", value: formBaseUrl, setValue: setFormBaseUrl },
          { id: "apiKey", label: "API Key", value: formApiKey, setValue: setFormApiKey, mask: "*" },
          { id: "model", label: "Model ID", value: formModel, setValue: setFormModel }
        ];
      default:
        return [
          { id: "apiKey", label: "API Key", value: formApiKey, setValue: setFormApiKey, mask: "*" },
          { id: "model", label: "Model ID", value: formModel, setValue: setFormModel }
        ];
    }
  }, [formProviderId, formApiKey, formModel, formBaseUrl, formDisplayName]);

  const formFields = getFormFields();

  // Run model discovery
  const triggerDiscovery = useCallback(
    async (apiKeyOverride?: string, baseUrlOverride?: string) => {
      if (discoveryAbortRef.current) {
        discoveryAbortRef.current.abort();
      }
      const abortController = new AbortController();
      discoveryAbortRef.current = abortController;

      setIsDiscovering(true);
      setDiscoveryError(null);

      let keyToUse = sanitizeApiKey(apiKeyOverride ?? formApiKey) || undefined;
      const urlToUse = sanitizeBaseUrl(baseUrlOverride ?? formBaseUrl);

      if (!keyToUse && editingProfileId) {
        try {
          const resolved = await profileStore.getResolvedProfile(editingProfileId);
          if (resolved?.apiKey) {
            keyToUse = resolved.apiKey;
          }
        } catch {
          // Ignore
        }
      }

      try {
        const result = await discoverAvailableModels({
          providerId: formProviderId,
          apiKey: keyToUse,
          baseUrl: urlToUse,
          signal: abortController.signal
        });

        if (abortController.signal.aborted) {
          return;
        }

        setIsDiscovering(false);

        if (result.models && result.models.length > 0) {
          setDiscoveredModels(result.models);
          setModelSelectIndex(0);
          setFormModel(result.models[0].id);
        }

        if (!result.success) {
          setDiscoveryError(result.error || "Model discovery failed.");
        } else {
          setDiscoveryError(null);
        }
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          return;
        }
        setIsDiscovering(false);
        const msg = err instanceof Error ? err.message : String(err);
        setDiscoveryError(msg);
      }
    },
    [formProviderId, formApiKey, formBaseUrl, editingProfileId, profileStore]
  );

  const handleFieldSubmit = useCallback(
    (submittedValue?: string) => {
      const currentField = formFields[formFieldIndex];

      if (currentField?.id === "model" && submittedValue !== undefined) {
        setFormModel(submittedValue);
      }
      if (currentField?.id === "apiKey" && submittedValue !== undefined) {
        setFormApiKey(sanitizeApiKey(submittedValue));
      }
      if (currentField?.id === "baseUrl" && submittedValue !== undefined) {
        setFormBaseUrl(sanitizeBaseUrl(submittedValue) || "");
      }

      if (formFieldIndex < formFields.length - 1) {
        const nextIdx = formFieldIndex + 1;
        setFormFieldIndex(nextIdx);

        // Transitioning into model field: automatically discover models
        if (formFields[nextIdx]?.id === "model") {
          const effectiveApiKey =
            currentField?.id === "apiKey"
              ? sanitizeApiKey(submittedValue ?? formApiKey)
              : sanitizeApiKey(formApiKey);
          const effectiveBaseUrl =
            currentField?.id === "baseUrl"
              ? sanitizeBaseUrl(submittedValue ?? formBaseUrl)
              : sanitizeBaseUrl(formBaseUrl);

          triggerDiscovery(effectiveApiKey, effectiveBaseUrl);
        }
      } else {
        // Validate
        const effectiveApiKey = sanitizeApiKey(
          currentField?.id === "apiKey" && submittedValue !== undefined
            ? submittedValue
            : formApiKey
        );
        const effectiveModel =
          currentField?.id === "model" && submittedValue !== undefined
            ? submittedValue
            : formModel;
        const effectiveBaseUrl = sanitizeBaseUrl(
          currentField?.id === "baseUrl" && submittedValue !== undefined
            ? submittedValue
            : formBaseUrl
        ) || "";

        if (formProviderId !== "ollama" && !effectiveApiKey && !editingProfileId) {
          setFormError("API key is required.");
          return;
        }
        if (!effectiveModel.trim()) {
          setFormError("Model ID is required.");
          return;
        }
        if (
          (formProviderId === "ollama" || formProviderId === "openai-compatible") &&
          !effectiveBaseUrl
        ) {
          setFormError("Base URL is required.");
          return;
        }

        // Test connection
        startConnectionTest({
          providerId: formProviderId,
          model: effectiveModel.trim(),
          apiKey: effectiveApiKey || undefined,
          baseUrl: effectiveBaseUrl || undefined
        });
      }
    },
    [
      formFields,
      formFieldIndex,
      formApiKey,
      formModel,
      formBaseUrl,
      formProviderId,
      editingProfileId,
      triggerDiscovery
    ]
  );

  // Keyboard navigation
  useInput((input, key) => {
    // Escape behavior
    if (key.escape) {
      if (mode === "testing") {
        if (testAbortControllerRef.current) {
          testAbortControllerRef.current.abort();
        }
        setMode("form");
        return;
      }
      if (mode === "form") {
        if (formFields[formFieldIndex]?.id === "model" && isCustomModel) {
          setIsCustomModel(false);
          if (modelSelectIndex >= discoveredModels.length) {
            setModelSelectIndex(0);
            if (discoveredModels[0]) {
              setFormModel(discoveredModels[0].id);
            }
          } else if (discoveredModels[modelSelectIndex]) {
            setFormModel(discoveredModels[modelSelectIndex].id);
          }
          return;
        }
        if (discoveryAbortRef.current) {
          discoveryAbortRef.current.abort();
        }
        setIsDiscovering(false);
        setFormApiKey("");
        setMode(profiles.length > 0 ? "list" : "onboarding-select");
        return;
      }
      if (mode === "show" || mode === "confirm-delete") {
        setMode("list");
        return;
      }
      if (mode === "list") {
        onClose();
        return;
      }
      if (mode === "onboarding-select" && profiles.length > 0) {
        setMode("list");
        return;
      }
      return;
    }

    // Mode: form (keyboard handling when on model field)
    if (mode === "form") {
      const currentField = formFields[formFieldIndex];
      if (currentField?.id === "model" && !isCustomModel) {
        if (isDiscovering) {
          return;
        }

        const totalOptions = discoveredModels.length + 1;

        if (key.upArrow) {
          const prev = (modelSelectIndex - 1 + totalOptions) % totalOptions;
          setModelSelectIndex(prev);
          if (prev < discoveredModels.length) {
            setFormModel(discoveredModels[prev].id);
          } else {
            setFormModel("");
          }
          return;
        }

        if (key.downArrow) {
          const next = (modelSelectIndex + 1) % totalOptions;
          setModelSelectIndex(next);
          if (next < discoveredModels.length) {
            setFormModel(discoveredModels[next].id);
          } else {
            setFormModel("");
          }
          return;
        }

        if (input && input.toLowerCase() === "r") {
          triggerDiscovery();
          return;
        }

        if (input && input.toLowerCase() === "m") {
          setIsCustomModel(true);
          return;
        }

        if (key.return) {
          if (modelSelectIndex === discoveredModels.length) {
            setIsCustomModel(true);
          } else {
            const chosen = discoveredModels[modelSelectIndex];
            const chosenModelId = chosen ? chosen.id : formModel;
            setFormModel(chosenModelId);
            handleFieldSubmit(chosenModelId);
          }
          return;
        }
      }
    }

    // 1. Mode: onboarding-select
    if (mode === "onboarding-select") {
      if (key.upArrow) {
        setSelectedProviderIndex((prev) => (prev > 0 ? prev - 1 : PROVIDER_OPTIONS.length - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedProviderIndex((prev) => (prev < PROVIDER_OPTIONS.length - 1 ? prev + 1 : 0));
        return;
      }
      if (key.return) {
        const chosen = PROVIDER_OPTIONS[selectedProviderIndex];
        setupFormForProvider(chosen.id);
        return;
      }
      if ((input === "q" || input === "b") && profiles.length > 0) {
        setMode("list");
        return;
      }
    }

    // 2. Mode: list
    if (mode === "list") {
      if (key.upArrow) {
        setSelectedListIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, profiles.length - 1)));
        return;
      }
      if (key.downArrow) {
        setSelectedListIndex((prev) => (prev < profiles.length - 1 ? prev + 1 : 0));
        return;
      }
      if (key.return || input === "a") {
        // Activate selected profile
        if (currentProfile) {
          profileStore.setActiveProfile(currentProfile.id).then(() => {
            setActiveProfileId(currentProfile.id);
            if (onActivateProfile) {
              onActivateProfile(currentProfile);
            }
          });
        }
        return;
      }
      if (input === "t") {
        // Test connection of selected profile
        if (currentProfile) {
          profileStore.getResolvedProfile(currentProfile.id).then((resolved) => {
            if (resolved) {
              startConnectionTest({
                providerId: resolved.profile.providerId,
                model: resolved.profile.model,
                apiKey: resolved.apiKey,
                baseUrl: resolved.profile.baseUrl
              });
            }
          });
        }
        return;
      }
      if (input === "n") {
        setMode("onboarding-select");
        return;
      }
      if (input === "e") {
        if (currentProfile) {
          setupFormForProvider(currentProfile.providerId, currentProfile);
        }
        return;
      }
      if (input === "d") {
        if (currentProfile) {
          setMode("confirm-delete");
        }
        return;
      }
      if (input === "s") {
        if (currentProfile) {
          setMode("show");
        }
        return;
      }
      if (input === "q") {
        onClose();
        return;
      }
    }

    // 3. Mode: confirm-delete
    if (mode === "confirm-delete") {
      if (input.toLowerCase() === "y" && currentProfile) {
        profileStore.deleteProfile(currentProfile.id).then(() => {
          reloadProfiles();
          setSelectedListIndex(0);
          setMode("list");
        });
        return;
      }
      if (input.toLowerCase() === "n" || key.escape) {
        setMode("list");
        return;
      }
    }

    // 4. Mode: show
    if (mode === "show") {
      if (key.return || key.escape || input === "q" || input === "b") {
        setMode("list");
        return;
      }
    }

    // 5. Mode: testing
    if (mode === "testing" && !isTesting && testResult) {
      if (key.return) {
        handleSaveProfile();
        return;
      }
      if (input.toLowerCase() === "r") {
        startConnectionTest({
          providerId: formProviderId,
          model: formModel,
          apiKey: formApiKey,
          baseUrl: formBaseUrl
        });
        return;
      }
      if (input.toLowerCase() === "e") {
        setMode("form");
        return;
      }
    }
  });

  // -------------------------------------------------------------
  // RENDER: 1. Onboarding / Provider Selection
  // -------------------------------------------------------------
  if (mode === "onboarding-select") {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        <Box justifyContent="center" marginBottom={1}>
          <Text bold color="cyan">Welcome to FeCode</Text>
        </Box>
        <Box justifyContent="center" marginBottom={1}>
          <Text color="white">Configure your AI provider</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="gray">Select a provider:</Text>
        </Box>
        {PROVIDER_OPTIONS.map((opt, idx) => {
          const isSelected = idx === selectedProviderIndex;
          return (
            <Box key={opt.id} marginLeft={1}>
              <Text color={isSelected ? "cyan" : "gray"} bold={isSelected}>
                {isSelected ? "> " : "  "}
              </Text>
              <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
                {opt.name}
              </Text>
              <Text color="gray"> ({opt.defaultModel})</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text color="gray">Use ↑/↓ arrows to navigate, Enter to continue{profiles.length > 0 ? ", Esc to cancel" : ""}</Text>
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------
  // RENDER: 2. Provider Configuration Form
  // -------------------------------------------------------------
  if (mode === "form") {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {editingProfileId ? "Edit Provider Profile" : "Configure AI Provider"}
          </Text>
          <Text color="gray"> — {formDisplayName || formProviderId}</Text>
        </Box>

        {formError && (
          <Box marginY={1}>
            <Text color="red">⚠ {formError}</Text>
          </Box>
        )}

        {formFields.map((field, idx) => {
          const isFocused = idx === formFieldIndex;
          const isModelField = field.id === "model";

          return (
            <Box key={field.id} flexDirection="column" marginY={0}>
              <Box>
                <Text color={isFocused ? "cyan" : "gray"} bold={isFocused}>
                  {field.label}:{" "}
                </Text>
                {!isModelField ? (
                  isFocused ? (
                    <EnhancedTextInput
                      value={field.value}
                      onChange={(val) => {
                        field.setValue(val);
                        if (formError) setFormError(null);
                      }}
                      onSubmit={(val) => handleFieldSubmit(val)}
                      mask={field.mask}
                      focus={true}
                    />
                  ) : (
                    <Text color="white">
                      {field.mask
                        ? field.value
                          ? "*".repeat(field.value.length)
                          : editingProfileId
                            ? "[Unchanged]"
                            : "[Empty]"
                        : field.value || "[Empty]"}
                    </Text>
                  )
                ) : (
                  // Model field rendering
                  !isFocused ? (
                    <Text color="white">{field.value || "[Empty]"}</Text>
                  ) : isDiscovering ? (
                    <Text color="cyan">
                      ⟳ Detecting available models for this provider...
                    </Text>
                  ) : isCustomModel ? (
                    <EnhancedTextInput
                      value={field.value}
                      onChange={(val) => {
                        field.setValue(val);
                        if (formError) setFormError(null);
                      }}
                      onSubmit={(val) => handleFieldSubmit(val)}
                      focus={true}
                    />
                  ) : null
                )}
              </Box>

              {isModelField && isFocused && !isDiscovering && !isCustomModel && (
                <Box flexDirection="column" marginLeft={2}>
                  {discoveredModels.map((m, mIdx) => {
                    const isSelected = mIdx === modelSelectIndex;
                    return (
                      <Box key={m.id}>
                        <Text color={isSelected ? "cyan" : "gray"} bold={isSelected}>
                          {isSelected ? "> " : "  "}
                        </Text>
                        <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
                          {m.displayName || m.id}
                        </Text>
                        {m.displayName && m.displayName !== m.id && (
                          <Text color="gray"> ({m.id})</Text>
                        )}
                        {m.isRecommended && (
                          <Text color="green" bold>
                            {" "}(Recommended)
                          </Text>
                        )}
                      </Box>
                    );
                  })}
                  <Box key="custom-model-option">
                    <Text
                      color={modelSelectIndex === discoveredModels.length ? "cyan" : "gray"}
                      bold={modelSelectIndex === discoveredModels.length}
                    >
                      {modelSelectIndex === discoveredModels.length ? "> " : "  "}
                    </Text>
                    <Text
                      color={modelSelectIndex === discoveredModels.length ? "white" : "gray"}
                      bold={modelSelectIndex === discoveredModels.length}
                    >
                      [ Custom Model ID... ]
                    </Text>
                  </Box>

                  {discoveryError && (
                    <Box marginTop={0}>
                      <Text color="yellow">
                        ⚠ Fallback models in use: {discoveryError}
                      </Text>
                    </Box>
                  )}

                  <Box marginTop={0}>
                    <Text color="gray">
                      [↑/↓] Select   [Enter] Confirm   [m] Custom ID   [r] Refresh
                    </Text>
                  </Box>
                </Box>
              )}

              {isModelField && isFocused && isCustomModel && (
                <Box marginLeft={2}>
                  <Text color="gray" dimColor>
                    [Esc] Back to discovered models list
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">
            [Tab / Enter] Next Field   [Shift+Tab] Prev Field   [Esc] Back
          </Text>
          <Text color="gray" dimColor>
            Credentials are securely encrypted in your OS Credential Manager.
          </Text>
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------
  // RENDER: 3. Connection Testing Status & Outcome
  // -------------------------------------------------------------
  if (mode === "testing") {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={isTesting ? "cyan" : testResult?.success ? "green" : "red"}
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        <Box marginBottom={1}>
          <Text bold color={isTesting ? "cyan" : testResult?.success ? "green" : "red"}>
            {isTesting ? "Testing Connection..." : testResult?.success ? "✓ Connection Successful" : "✗ Connection Failed"}
          </Text>
        </Box>

        {isTesting && (
          <Box marginY={1}>
            <Text color="cyan">Testing authentication and model availability for {formModel}...</Text>
          </Box>
        )}

        {!isTesting && testResult && (
          <Box flexDirection="column" marginY={1}>
            <Box>
              <Text color={testResult.steps.authentication === "success" ? "green" : "red"}>
                {testResult.steps.authentication === "success" ? "✓ " : "✗ "}
              </Text>
              <Text color="white">Authentication: {testResult.steps.authentication}</Text>
            </Box>
            <Box>
              <Text color={testResult.steps.modelAvailable === "success" ? "green" : "red"}>
                {testResult.steps.modelAvailable === "success" ? "✓ " : "✗ "}
              </Text>
              <Text color="white">Model Availability: {testResult.steps.modelAvailable}</Text>
            </Box>

            <Box marginTop={1}>
              <Text color={testResult.success ? "green" : "red"}>
                {testResult.message}
              </Text>
            </Box>

            {testResult.durationMs > 0 && (
              <Box marginTop={0}>
                <Text color="gray">Latency: {testResult.durationMs}ms</Text>
              </Box>
            )}
          </Box>
        )}

        <Box marginTop={1}>
          {!isTesting && testResult?.success ? (
            <Text color="green" bold>
              Press [Enter] to Save & Activate   [e] Edit Form   [Esc] Cancel
            </Text>
          ) : !isTesting ? (
            <Text color="gray">
              [r] Retry   [e] Edit Form   [Enter] Save Anyway   [Esc] Cancel
            </Text>
          ) : (
            <Text color="gray">Press [Esc] to cancel test</Text>
          )}
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------
  // RENDER: 4. Profile Details View (Show)
  // -------------------------------------------------------------
  if (mode === "show" && currentProfile) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">Provider Profile Details</Text>
          <Text color="white"> — {currentProfile.displayName}</Text>
        </Box>

        <Box flexDirection="column">
          <Text color="gray">Profile ID:           <Text color="white">{currentProfile.id}</Text></Text>
          <Text color="gray">Display Name:         <Text color="white">{currentProfile.displayName}</Text></Text>
          <Text color="gray">Provider:             <Text color="white">{currentProfile.providerId}</Text></Text>
          <Text color="gray">Model:                <Text color="white">{currentProfile.model}</Text></Text>
          {currentProfile.baseUrl && (
            <Text color="gray">Base URL:             <Text color="white">{currentProfile.baseUrl}</Text></Text>
          )}
          <Text color="gray">Credential Reference: <Text color="white">{currentProfile.credentialReference || "[None required]"}</Text></Text>
          <Text color="gray">Credential Storage:   <Text color="white">OS Credential Manager (Encrypted)</Text></Text>
          <Text color="gray">Active Profile:       <Text color={currentProfile.id === activeProfileId ? "green" : "gray"}>{currentProfile.id === activeProfileId ? "Yes" : "No"}</Text></Text>
          <Text color="gray">Created At:           <Text color="white">{currentProfile.createdAt}</Text></Text>
          <Text color="gray">Updated At:           <Text color="white">{currentProfile.updatedAt}</Text></Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray">[Esc / Enter / q] Back to profile list</Text>
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------
  // RENDER: 5. Delete Confirmation
  // -------------------------------------------------------------
  if (mode === "confirm-delete" && currentProfile) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        paddingX={2}
        paddingY={1}
        marginY={1}
      >
        <Box marginBottom={1}>
          <Text bold color="red">Delete Provider Profile?</Text>
        </Box>
        <Text color="white">
          Are you sure you want to delete profile &quot;{currentProfile.displayName}&quot; ({currentProfile.model})?
        </Text>
        <Text color="gray">
          This will permanently remove the profile and its stored OS credential.
        </Text>
        <Box marginTop={1}>
          <Text bold color="yellow">
            Press [y] to Confirm   [n / Esc] to Cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------
  // RENDER: 6. Profile List View
  // -------------------------------------------------------------
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">Saved Provider Profiles</Text>
        <Text color="gray">{profiles.length} profile{profiles.length === 1 ? "" : "s"}</Text>
      </Box>

      {profiles.length === 0 ? (
        <Box marginY={1}>
          <Text color="gray">No saved provider profiles. Press [n] to add one.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {profiles.map((p, idx) => {
            const isSelected = idx === selectedListIndex;
            const isActive = p.id === activeProfileId;
            return (
              <Box key={p.id}>
                <Text color={isSelected ? "cyan" : "gray"} bold={isSelected}>
                  {isSelected ? "> " : "  "}
                </Text>
                <Box width={20}>
                  <Text color={isSelected ? "white" : "gray"} bold={isSelected}>
                    {p.displayName}
                  </Text>
                </Box>
                <Box width={30}>
                  <Text color="white">{p.model}</Text>
                </Box>
                {isActive && (
                  <Text color="green" bold>
                    * [ACTIVE]
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          [Enter/a] Activate   [t] Test   [n] Add   [e] Edit   [d] Delete   [s] Show   [Esc] Close
        </Text>
      </Box>
    </Box>
  );
};
