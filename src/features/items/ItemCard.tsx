import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Item, ItemType } from '@/types';

interface ItemCardProps {
  item: Item;
  onPress: (item: Item) => void;
}

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  link: '↗  Ссылка',
  table: '▦  Таблица',
  file: '▤  Файл',
  image: '▧  Изображение',
  text: 'T  Текст',
};

const COPY_STATUS_LABELS: Record<Item['copyStatus'], string> = {
  full: 'Полная',
  text_only: 'Только текст',
  none: 'Нет',
};

const COPY_STATUS_STYLES = StyleSheet.create({
  full: { backgroundColor: '#064E3B', color: '#A7F3D0' },
  text_only: { backgroundColor: '#713F12', color: '#FDE68A' },
  none: { backgroundColor: '#7F1D1D', color: '#FECACA' },
});

export function ItemCard({ item, onPress }: ItemCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${ITEM_TYPE_LABELS[item.type]}`}
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.typeRow}>
        <Text style={styles.typeLabel}>{ITEM_TYPE_LABELS[item.type]}</Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.description} numberOfLines={2}>
        {item.description}
      </Text>
      <View style={styles.footer}>
        <Text style={styles.sourceLabel} numberOfLines={1}>
          {item.sourceLabel}
        </Text>
        {item.type === 'link' && (
          <Text
            style={[
              styles.copyBadge,
              COPY_STATUS_STYLES[item.copyStatus],
            ]}
          >
            {COPY_STATUS_LABELS[item.copyStatus]}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 78,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    gap: 6,
  },
  cardPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  typeRow: {
    minHeight: 18,
    justifyContent: 'center',
  },
  typeLabel: {
    color: '#7DD3FC',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  description: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sourceLabel: {
    flex: 1,
    color: '#64748B',
    fontSize: 12,
  },
  copyBadge: {
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
  },
});
