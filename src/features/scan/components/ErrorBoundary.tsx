import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  children: React.ReactNode;
  label?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>{this.props.label ?? 'Error'}</Text>
          <Text style={styles.body} numberOfLines={6}>
            {this.state.error.message}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(60,10,10,0.85)',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  title: { color: '#f97373', fontWeight: '700', fontSize: 12 },
  body: { color: '#fff', fontFamily: 'monospace', fontSize: 11 },
});
