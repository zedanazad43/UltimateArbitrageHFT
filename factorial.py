user_input = input("Enter a number: ")

try:
    number = int(user_input)
except ValueError:
    print("Please enter a valid integer.")
else:
    if number < 0:
        print("Factorial is not defined for negative numbers.")
    else:
        factorial = 1
        for i in range(2, number + 1):
            factorial *= i
        print(f"Factorial: {factorial}")
