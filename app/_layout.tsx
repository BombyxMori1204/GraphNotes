import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { initDatabase } from '@/db/client';

type DatabaseStatus = 'loading' | 'ready' | 'error';

export default function RootLayout() {
  const [status, setStatus] = useState<DatabaseStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void initDatabase()
      .then(() => {
        if (isMounted) {
          setStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : String(error),
          );
          setStatus('error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {status === 'ready' ? (
          <Stack screenOptions={{ headerShown: true }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="dev/proto-graph"
              options={{ title: 'Прототип графа' }}
            />
            <Stack.Screen
              name="dev/proto-embeddings"
              options={{ title: 'Прототип эмбеддингов' }}
            />
          </Stack>
        ) : (
          <SafeAreaView style={styles.centered}>
            {status === 'loading' ? (
              <>
                <ActivityIndicator size="large" />
                <Text style={styles.message}>Инициализация базы данных…</Text>
              </>
            ) : (
              <View style={styles.error}>
                <Text style={styles.title}>Не удалось запустить базу данных</Text>
                <Text>{errorMessage}</Text>
              </View>
            )}
          </SafeAreaView>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    marginTop: 16,
  },
  error: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
});
