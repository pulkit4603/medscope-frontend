import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { Feather } from "@expo/vector-icons";

import { HapticTab } from "@/components/HapticTab";
import TabBarBackground from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            // Use a transparent background on iOS to show the blur effect
            position: "absolute",
          },
          default: {},
        }),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <Feather name="home" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color }) => (
            <Feather name="message-circle" size={24} color={color} />
          ),
        }}
        listeners={() => ({
          tabPress: (e) => {
            // Prevent default behavior
            e.preventDefault();
            // Show a message or handle the action
            alert("Chat feature coming soon!");
          },
        })}
      />
      {/* <Tabs.Screen
        name="imaging"
        options={{
          title: "Imaging",
          tabBarIcon: ({ color }) => (
            <Feather name="camera" size={24} color={color} />
          ),
        }}
      /> */}
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <Feather name="user" size={24} color={color} />
          ),
        }}
        listeners={() => ({
          tabPress: (e) => {
            // Prevent default behavior
            e.preventDefault();
            // Show a message or handle the action
            alert("Profile feature coming soon!");
          },
        })}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color }) => (
            <Feather name="calendar" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
