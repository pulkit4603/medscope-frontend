import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  SafeAreaView,
} from "react-native";
import { Feather, FontAwesome5, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";

export default function HomeScreen() {
  // Sample profile image URL - replace with actual user image path
  const profileImage = "https://randomuser.me/api/portraits/men/32.jpg";

  // Categories data
  const categories = [
    { name: "Favorite", icon: "heart", iconType: "feather" },
    { name: "Tests", icon: "vial", iconType: "fontAwesome" },
    { name: "Pharmacy", icon: "capsules", iconType: "fontAwesome" },
    { name: "Specialties", icon: "star", iconType: "feather" },
    { name: "Record", icon: "clipboard", iconType: "feather" },
  ];

  // Supported tests data with updated icons that are available in the icon packs
  const supportedTests = [
    { name: "Otoscopy", icon: "hearing", iconType: "material" },
    { name: "Pharyngoscopy", icon: "user-md", iconType: "fontAwesome" },
    { name: "Dermatoscopy", icon: "fingerprint", iconType: "material" },
    { name: "Auscultation (Lungs)", icon: "wind", iconType: "feather" },
    { name: "Auscultation (Stomach)", icon: "pie-chart", iconType: "feather" },
    { name: "Auscultation (Heart)", icon: "heart", iconType: "fontAwesome" },
  ];

  const navigateToSupportedTests = () => {
    router.push("/SupportedTestsScreen");
  };

  const renderIcon = (item: any, isCategory = false) => {
    const iconColor = isCategory ? "#4A90E2" : "#FFFFFF";

    if (item.iconType === "feather") {
      return <Feather name={item.icon} size={24} color={iconColor} />;
    } else if (item.iconType === "fontAwesome") {
      return <FontAwesome5 name={item.icon} size={24} color={iconColor} />;
    } else if (item.iconType === "material") {
      return <MaterialIcons name={item.icon} size={24} color={iconColor} />;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top Section with Profile */}
        <View style={styles.profileSection}>
          <View style={styles.welcomeContainer}>
            <Text style={styles.welcomeText}>Welcome Back,</Text>
            <Text style={styles.nameText}>Aditya Nagane</Text>
          </View>
          <View style={styles.profileImageContainer}>
            <Image source={{ uri: profileImage }} style={styles.profileImage} />
          </View>
        </View>

        {/* Categories Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <TouchableOpacity>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesContainer}
          >
            {categories.map((category, index) => (
              <TouchableOpacity key={index} style={styles.categoryItem}>
                <View style={styles.categoryIconContainer}>
                  {renderIcon(category, true)}
                </View>
                <Text style={styles.categoryText}>{category.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Supported Tests Section */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Supported Tests</Text>
            <TouchableOpacity onPress={navigateToSupportedTests}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.testsGrid}>
            {supportedTests.map((test, index) => (
              <TouchableOpacity key={index} style={styles.testCard}>
                <LinearGradient
                  colors={["#4A90E2", "#5AC8FA"]}
                  style={styles.gradient}
                >
                  {renderIcon(test)}
                  <Text style={styles.testName}>{test.name}</Text>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Recent Tests Section */}
        <View style={[styles.sectionContainer, { marginBottom: 20 }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Tests</Text>
            <TouchableOpacity>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>

          {/* Empty content for now - as requested */}
          <View style={styles.emptyRecentTests}>
            <Text style={styles.emptyText}>No recent tests available</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingTop: 16, // Adding top padding to the safe area
  },
  container: {
    flex: 1,
    padding: 16,
  },
  profileSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    marginBottom: 20,
  },
  welcomeContainer: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 16,
    color: "#64748B",
  },
  nameText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1E293B",
  },
  profileImageContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#4A90E2",
  },
  profileImage: {
    width: "100%",
    height: "100%",
  },
  sectionContainer: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1E293B",
  },
  seeAllText: {
    fontSize: 14,
    color: "#4A90E2",
  },
  categoriesContainer: {
    paddingBottom: 8,
  },
  categoryItem: {
    alignItems: "center",
    marginRight: 24,
    width: 70,
  },
  categoryIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#EFF6FF",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  categoryText: {
    fontSize: 12,
    color: "#475569",
    textAlign: "center",
  },
  testsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  testCard: {
    width: "31%",
    aspectRatio: 1,
    marginBottom: 10,
    borderRadius: 12,
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  gradient: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  testName: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 8,
  },
  emptyRecentTests: {
    height: 100,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
  },
  emptyText: {
    color: "#94A3B8",
    fontSize: 16,
  },
});
