import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>LocalVault MVP</Text>
        <Text style={styles.status}>База данных инициализирована</Text>

        {__DEV__ ? (
          <Link href="/dev/proto-embeddings" asChild>
            <Pressable style={styles.button}>
              <Text style={styles.buttonText}>Прототип эмбеддингов</Text>
            </Pressable>
          </Link>
        ) : null}
        <Link href="/dev/proto-graph" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Прототип графа</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  status: {
    marginBottom: 8,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#2457D6',
    padding: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
