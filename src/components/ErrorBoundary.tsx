import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// App-wide error boundary. Without this, a render exception in any
// screen tears down the entire React tree and Android shows the
// generic "App keeps stopping" dialog → the user feels the app
// "auto-closed". Wrapping AppNavigator means a bad screen falls back
// to a Retry view instead of crashing the process.

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.log('[ErrorBoundary] caught:', error?.message, info?.componentStack);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0D3B66',
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: '#5C6A7A',
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    backgroundColor: '#0D3B66',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});

export default ErrorBoundary;
